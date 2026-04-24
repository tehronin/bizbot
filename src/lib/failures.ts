import crypto from "node:crypto";
import type { ToolExecutionResult } from "@/lib/agent/tools";

export type FailureLayer = "infra" | "network" | "tool" | "validation" | "semantic" | "policy" | "unknown";

export type FailureKind =
  | "timeout"
  | "auth"
  | "unavailable"
  | "bad_input"
  | "contract_drift"
  | "repeated_failure"
  | "aborted"
  | "policy_blocked"
  | "max_rounds"
  | "unknown";

export interface FailureEnvelope {
  version: 1;
  fingerprint: string;
  layer: FailureLayer;
  kind: FailureKind;
  retryable: boolean;
  resumeSafe: boolean;
  suggestedNextAction: string;
  operatorSummary: string;
  raw: string;
  errorName: string | null;
  code: string | null;
  statusCode: number | null;
  source?: {
    component?: string;
    operation?: string;
    toolName?: string;
    serverName?: string;
    target?: string;
  };
}

export interface NormalizeFailureOptions {
  component?: string;
  operation?: string;
  toolName?: string;
  serverName?: string;
  target?: string;
  layer?: FailureLayer;
  kind?: FailureKind;
  retryable?: boolean;
  resumeSafe?: boolean;
  suggestedNextAction?: string;
  operatorSummary?: string;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function extractRawFailure(error: unknown): { raw: string; errorName: string | null; code: string | null; statusCode: number | null } {
  if (error instanceof Error) {
    const candidate = error as Error & { code?: unknown; status?: unknown; statusCode?: unknown; cause?: unknown };
    return {
      raw: error.message || String(error),
      errorName: error.name || null,
      code: readString(candidate.code),
      statusCode: readNumber(candidate.statusCode) ?? readNumber(candidate.status),
    };
  }

  if (typeof error === "string") {
    return { raw: error, errorName: null, code: null, statusCode: null };
  }

  if (error && typeof error === "object") {
    const candidate = error as Record<string, unknown>;
    const raw = readString(candidate.error)
      ?? readString(candidate.message)
      ?? readString(candidate.summary)
      ?? JSON.stringify(candidate);

    return {
      raw,
      errorName: readString(candidate.name),
      code: readString(candidate.code),
      statusCode: readNumber(candidate.statusCode) ?? readNumber(candidate.status),
    };
  }

  return { raw: String(error), errorName: null, code: null, statusCode: null };
}

function buildSummaryLabel(options: NormalizeFailureOptions): string {
  return options.toolName
    ?? options.operation
    ?? options.component
    ?? options.serverName
    ?? "operation";
}

function classifyFailure(
  raw: string,
  errorName: string | null,
  code: string | null,
  statusCode: number | null,
  options: NormalizeFailureOptions,
): Omit<FailureEnvelope, "version" | "fingerprint" | "raw" | "errorName" | "code" | "statusCode" | "source"> {
  const lower = raw.toLowerCase();
  const normalizedCode = code?.toLowerCase() ?? null;
  const label = buildSummaryLabel(options);

  if (options.kind === "max_rounds" || /maximum number of tool-use steps|maximum tool rounds|max tool rounds/i.test(raw)) {
    return {
      layer: "semantic",
      kind: "max_rounds",
      retryable: options.retryable ?? false,
      resumeSafe: options.resumeSafe ?? true,
      suggestedNextAction: options.suggestedNextAction ?? "narrow_request",
      operatorSummary: options.operatorSummary ?? `${label} exhausted the allowed tool rounds.`,
    };
  }

  if (options.kind === "contract_drift" || /contract drift|schema mismatch|inventory drift|unsupported tool|unknown tool|resource .* not found in catalog/i.test(raw)) {
    return {
      layer: "validation",
      kind: "contract_drift",
      retryable: options.retryable ?? false,
      resumeSafe: options.resumeSafe ?? true,
      suggestedNextAction: options.suggestedNextAction ?? "refresh_contracts",
      operatorSummary: options.operatorSummary ?? `${label} failed because the contract or catalog no longer matches runtime expectations.`,
    };
  }

  if (options.kind === "repeated_failure" || /repeated the same failure|without changing the outcome|stuck loop/i.test(lower)) {
    return {
      layer: "semantic",
      kind: "repeated_failure",
      retryable: options.retryable ?? false,
      resumeSafe: options.resumeSafe ?? false,
      suggestedNextAction: options.suggestedNextAction ?? "inspect_stuck_loop",
      operatorSummary: options.operatorSummary ?? `${label} is repeating the same failure without making progress.`,
    };
  }

  if (
    options.kind === "policy_blocked"
    || /not allowed|blocked tool|approval queue|permission denied|policy|allowlisted|allowlist/i.test(raw)
    || statusCode === 403
  ) {
    return {
      layer: "policy",
      kind: "policy_blocked",
      retryable: options.retryable ?? false,
      resumeSafe: options.resumeSafe ?? true,
      suggestedNextAction: options.suggestedNextAction ?? "check_policy",
      operatorSummary: options.operatorSummary ?? `${label} was blocked by a tool, permission, or execution policy.`,
    };
  }

  if (
    options.kind === "auth"
    || /unauthorized|forbidden|invalid api key|invalid token|credentials?|authentication/i.test(raw)
    || statusCode === 401
  ) {
    return {
      layer: "policy",
      kind: "auth",
      retryable: options.retryable ?? false,
      resumeSafe: options.resumeSafe ?? true,
      suggestedNextAction: options.suggestedNextAction ?? "check_credentials",
      operatorSummary: options.operatorSummary ?? `${label} failed authentication or authorization checks.`,
    };
  }

  if (
    options.kind === "timeout"
    || /timed out|timeout|deadline exceeded/i.test(raw)
    || normalizedCode === "etimedout"
    || errorName === "AbortError"
  ) {
    return {
      layer: options.layer ?? (options.serverName ? "network" : "tool"),
      kind: /abort/i.test(raw) || errorName === "AbortError" ? "aborted" : "timeout",
      retryable: options.retryable ?? true,
      resumeSafe: options.resumeSafe ?? false,
      suggestedNextAction: options.suggestedNextAction ?? "retry_with_backoff",
      operatorSummary: options.operatorSummary ?? `${label} did not finish before the timeout or abort boundary.`,
    };
  }

  if (
    options.kind === "unavailable"
    || /network|fetch failed|connection refused|econnreset|enotfound|service unavailable|temporarily unavailable|socket hang up/i.test(raw)
    || normalizedCode === "econnreset"
    || normalizedCode === "enotfound"
    || normalizedCode === "econnrefused"
    || (statusCode !== null && statusCode >= 500)
  ) {
    return {
      layer: options.layer ?? "network",
      kind: "unavailable",
      retryable: options.retryable ?? true,
      resumeSafe: options.resumeSafe ?? false,
      suggestedNextAction: options.suggestedNextAction ?? "retry",
      operatorSummary: options.operatorSummary ?? `${label} is unavailable or the transport failed.`,
    };
  }

  if (
    options.kind === "bad_input"
    || /missing required|must be |invalid |unexpected tool argument|bad request|failed validation/i.test(raw)
    || (statusCode !== null && statusCode >= 400 && statusCode < 500)
  ) {
    return {
      layer: "validation",
      kind: "bad_input",
      retryable: options.retryable ?? false,
      resumeSafe: options.resumeSafe ?? true,
      suggestedNextAction: options.suggestedNextAction ?? "fix_input",
      operatorSummary: options.operatorSummary ?? `${label} rejected the current input or argument shape.`,
    };
  }

  return {
    layer: options.layer ?? "unknown",
    kind: options.kind ?? "unknown",
    retryable: options.retryable ?? false,
    resumeSafe: options.resumeSafe ?? false,
    suggestedNextAction: options.suggestedNextAction ?? "inspect_failure",
    operatorSummary: options.operatorSummary ?? `${label} failed with an unclassified runtime error.`,
  };
}

export function normalizeFailure(error: unknown, options: NormalizeFailureOptions = {}): FailureEnvelope {
  const extracted = extractRawFailure(error);
  const classified = classifyFailure(
    extracted.raw,
    extracted.errorName,
    extracted.code,
    extracted.statusCode,
    options,
  );
  const fingerprintSource = JSON.stringify({
    layer: classified.layer,
    kind: classified.kind,
    raw: extracted.raw.toLowerCase(),
    code: extracted.code,
    statusCode: extracted.statusCode,
    toolName: options.toolName ?? null,
    operation: options.operation ?? null,
    serverName: options.serverName ?? null,
    target: options.target ?? null,
  });

  return {
    version: 1,
    fingerprint: crypto.createHash("sha1").update(fingerprintSource).digest("hex").slice(0, 16),
    ...classified,
    raw: extracted.raw,
    errorName: extracted.errorName,
    code: extracted.code,
    statusCode: extracted.statusCode,
    source: options.component || options.operation || options.toolName || options.serverName || options.target
      ? {
          ...(options.component ? { component: options.component } : {}),
          ...(options.operation ? { operation: options.operation } : {}),
          ...(options.toolName ? { toolName: options.toolName } : {}),
          ...(options.serverName ? { serverName: options.serverName } : {}),
          ...(options.target ? { target: options.target } : {}),
        }
      : undefined,
  };
}

export function isFailureEnvelope(value: unknown): value is FailureEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return candidate.version === 1
    && typeof candidate.fingerprint === "string"
    && typeof candidate.layer === "string"
    && typeof candidate.kind === "string"
    && typeof candidate.retryable === "boolean"
    && typeof candidate.resumeSafe === "boolean"
    && typeof candidate.suggestedNextAction === "string"
    && typeof candidate.operatorSummary === "string"
    && typeof candidate.raw === "string";
}

export function getToolResultFailure(
  result: ToolExecutionResult,
  options: NormalizeFailureOptions,
): { result: ToolExecutionResult; failure: FailureEnvelope | null; isError: boolean } {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return { result, failure: null, isError: false };
  }

  const candidate = result as Record<string, unknown>;
  const existingFailure = candidate.failure;
  if (isFailureEnvelope(existingFailure)) {
    return {
      result,
      failure: existingFailure,
      isError: typeof candidate.error === "string" || candidate.ok === false,
    };
  }

  const errorText = readString(candidate.error)
    ?? (candidate.ok === false ? readString(candidate.message) : null);

  if (!errorText) {
    return { result, failure: null, isError: false };
  }

  const failure = normalizeFailure(errorText, options);
  return {
    result: {
      ...candidate,
      error: errorText,
      failure,
    },
    failure,
    isError: true,
  };
}