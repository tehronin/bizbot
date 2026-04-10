import { readBuilderProjectEnvValue } from "@/lib/builder/environment";
import { appendBuilderCapabilityAuditEvent } from "@/lib/builder/audit";
import { getBuilderAllowedHosts } from "@/lib/builder/config";

const DEFAULT_HTTP_TIMEOUT_SECONDS = 30;
const MAX_HTTP_TIMEOUT_SECONDS = 120;
const DEFAULT_HTTP_MAX_BYTES = 64_000;
const MAX_HTTP_MAX_BYTES = 256_000;
const DEFAULT_HTTP_MAX_REQUEST_BYTES = 16_000;
const MAX_HTTP_MAX_REQUEST_BYTES = 64_000;
const DEFAULT_HTTP_RETRY_COUNT = 1;
const MAX_HTTP_RETRY_COUNT = 2;
const SENSITIVE_HEADER_NAMES = new Set(["authorization", "proxy-authorization", "cookie", "set-cookie", "x-api-key"]);

export interface BuilderHttpRequestArgs {
  projectId: string;
  projectRelativePath: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  url: string;
  headers?: Array<{ name: string; value: string }>;
  body?: string;
  contentType?: string;
  timeoutSeconds?: number;
  maxBytes?: number;
  authEnvKey?: string;
  authHeaderName?: string;
  authScheme?: string;
  maxRequestBytes?: number;
  retryCount?: number;
}

export interface BuilderHttpResponse {
  ok: boolean;
  status: number;
  statusText: string;
  url: string;
  method: string;
  contentType: string | null;
  body: string;
  responseBytes: number;
  truncated: boolean;
  auditPath: string;
}

function clampHttpTimeoutSeconds(raw: number | undefined): number {
  const candidate = Math.trunc(raw ?? DEFAULT_HTTP_TIMEOUT_SECONDS);
  return Math.min(MAX_HTTP_TIMEOUT_SECONDS, Math.max(1, candidate));
}

function clampHttpMaxBytes(raw: number | undefined): number {
  const candidate = Math.trunc(raw ?? DEFAULT_HTTP_MAX_BYTES);
  return Math.min(MAX_HTTP_MAX_BYTES, Math.max(256, candidate));
}

function clampHttpMaxRequestBytes(raw: number | undefined): number {
  const candidate = Math.trunc(raw ?? DEFAULT_HTTP_MAX_REQUEST_BYTES);
  return Math.min(MAX_HTTP_MAX_REQUEST_BYTES, Math.max(256, candidate));
}

function clampHttpRetryCount(raw: number | undefined): number {
  const candidate = Math.trunc(raw ?? DEFAULT_HTTP_RETRY_COUNT);
  return Math.min(MAX_HTTP_RETRY_COUNT, Math.max(0, candidate));
}

function normalizeHostEntry(entry: string): string {
  return entry.trim().toLowerCase();
}

function hostMatchesAllowlist(target: URL, allowedHosts: string[]): boolean {
  const host = target.host.toLowerCase();
  const hostname = target.hostname.toLowerCase();
  const origin = target.origin.toLowerCase();
  return allowedHosts.map(normalizeHostEntry).some((entry) => entry === host || entry === hostname || entry === origin);
}

function assertSafeHeaders(headers?: Array<{ name: string; value: string }>): Record<string, string> {
  if (!headers) {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const header of headers) {
    const headerName = header.name.trim();
    if (!headerName) {
      continue;
    }
    if (SENSITIVE_HEADER_NAMES.has(headerName.toLowerCase())) {
      throw new Error(`Builder HTTP header ${headerName} must come from an approved env reference, not inline input.`);
    }
    normalized[headerName] = header.value;
  }
  return normalized;
}

async function readResponseBody(response: Response, maxBytes: number): Promise<{ body: string; responseBytes: number; truncated: boolean }> {
  if (!response.body) {
    return { body: "", responseBytes: 0, truncated: false };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }

    const nextTotal = total + value.length;
    if (nextTotal > maxBytes) {
      const remaining = Math.max(0, maxBytes - total);
      if (remaining > 0) {
        chunks.push(value.subarray(0, remaining));
        total += remaining;
      }
      truncated = true;
      await reader.cancel();
      break;
    }

    chunks.push(value);
    total = nextTotal;
  }

  return {
    body: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf-8"),
    responseBytes: total,
    truncated,
  };
}

function resolveAuthHeader(projectRelativePath: string, authEnvKey: string | undefined, authHeaderName: string | undefined, authScheme: string | undefined): Record<string, string> {
  const envKey = authEnvKey?.trim();
  if (!envKey) {
    return {};
  }

  const projectValue = readBuilderProjectEnvValue(projectRelativePath, envKey, { reveal: true }).value;
  const resolvedValue = (projectValue ?? process.env[envKey] ?? "").trim();
  if (!resolvedValue) {
    throw new Error(`Builder HTTP auth env key ${envKey} is missing.`);
  }

  const headerName = authHeaderName?.trim() || "Authorization";
  const prefix = authScheme?.trim();
  return {
    [headerName]: prefix ? `${prefix} ${resolvedValue}` : resolvedValue,
  };
}

function getRequestBodyBytes(body: string | undefined): number {
  return body ? Buffer.byteLength(body, "utf-8") : 0;
}

export async function builderHttpRequest(args: BuilderHttpRequestArgs): Promise<BuilderHttpResponse> {
  const timeoutSeconds = clampHttpTimeoutSeconds(args.timeoutSeconds);
  const maxBytes = clampHttpMaxBytes(args.maxBytes);
  const maxRequestBytes = clampHttpMaxRequestBytes(args.maxRequestBytes);
  const retryCount = clampHttpRetryCount(args.retryCount);
  const parsed = new URL(args.url);
  const requestBytes = getRequestBodyBytes(args.body);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    const audit = appendBuilderCapabilityAuditEvent({
      capabilityKey: "network_http",
      projectRelativePath: args.projectRelativePath,
      projectId: args.projectId,
      outcomeStatus: "blocked",
      targets: [{ kind: "host", identifier: parsed.origin }],
      metadata: { method: args.method, reason: "unsupported_protocol" },
    });
    throw new Error(`Builder HTTP only supports http and https URLs. Audit: ${audit.auditPath}`);
  }

  const allowedHosts = getBuilderAllowedHosts();
  if (allowedHosts.length === 0 || !hostMatchesAllowlist(parsed, allowedHosts)) {
    const audit = appendBuilderCapabilityAuditEvent({
      capabilityKey: "network_http",
      projectRelativePath: args.projectRelativePath,
      projectId: args.projectId,
      outcomeStatus: "blocked",
      targets: [{ kind: "host", identifier: parsed.origin }],
      metadata: { method: args.method, reason: "host_not_allowlisted" },
    });
    throw new Error(`Builder HTTP host is not allowlisted: ${parsed.origin}. Audit: ${audit.auditPath}`);
  }

  if (requestBytes > maxRequestBytes) {
    const audit = appendBuilderCapabilityAuditEvent({
      capabilityKey: "network_http",
      projectRelativePath: args.projectRelativePath,
      projectId: args.projectId,
      outcomeStatus: "blocked",
      targets: [{ kind: "host", identifier: parsed.origin }],
      metadata: { method: args.method, reason: "request_too_large", requestBytes, maxRequestBytes },
    });
    throw new Error(`Builder HTTP request body exceeds the configured limit (${requestBytes} > ${maxRequestBytes}). Audit: ${audit.auditPath}`);
  }

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
    try {
      const response = await fetch(parsed, {
        method: args.method,
        headers: {
          ...assertSafeHeaders(args.headers),
          ...(args.contentType?.trim() ? { "Content-Type": args.contentType.trim() } : {}),
          ...resolveAuthHeader(args.projectRelativePath, args.authEnvKey, args.authHeaderName, args.authScheme),
        },
        body: args.method === "GET" || args.method === "DELETE" ? undefined : args.body,
        signal: controller.signal,
      });
      const body = await readResponseBody(response, maxBytes);
      if (!response.ok && response.status >= 500 && attempt < retryCount) {
        continue;
      }
      const audit = appendBuilderCapabilityAuditEvent({
        capabilityKey: "network_http",
        projectRelativePath: args.projectRelativePath,
        projectId: args.projectId,
        outcomeStatus: response.ok ? "succeeded" : "failed",
        targets: [{ kind: "host", identifier: parsed.origin }],
        metadata: {
          method: args.method,
          path: parsed.pathname,
          status: response.status,
          contentType: response.headers.get("content-type"),
          requestBytes,
          maxRequestBytes,
          responseBytes: body.responseBytes,
          truncated: body.truncated,
          timeoutSeconds,
          attempts: attempt + 1,
          retryCount,
          authSource: args.authEnvKey ? "env_reference" : "none",
        },
      });
      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        url: parsed.toString(),
        method: args.method,
        contentType: response.headers.get("content-type"),
        body: body.body,
        responseBytes: body.responseBytes,
        truncated: body.truncated,
        auditPath: audit.auditPath,
      };
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "AbortError";
      const shouldRetry = attempt < retryCount && (timedOut || args.method === "GET" || args.method === "DELETE");
      if (shouldRetry) {
        continue;
      }
      const audit = appendBuilderCapabilityAuditEvent({
        capabilityKey: "network_http",
        projectRelativePath: args.projectRelativePath,
        projectId: args.projectId,
        outcomeStatus: timedOut ? "timed_out" : "failed",
        targets: [{ kind: "host", identifier: parsed.origin }],
        metadata: {
          method: args.method,
          path: parsed.pathname,
          timeoutSeconds,
          attempts: attempt + 1,
          retryCount,
          requestBytes,
          maxRequestBytes,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      throw new Error(`${timedOut ? "Builder HTTP request timed out" : "Builder HTTP request failed"}: ${error instanceof Error ? error.message : String(error)}. Audit: ${audit.auditPath}`);
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  throw new Error("Builder HTTP request failed after exhausting retry attempts.");
}