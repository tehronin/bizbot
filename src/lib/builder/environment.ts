import fs from "fs";
import path from "path";
import { parse as parseDotenv } from "dotenv";
import { appendBuilderCapabilityAuditEvent, type BuilderCapabilityAuditContext } from "@/lib/builder/audit";
import { resolveBuilderWorkspacePath } from "@/lib/builder/config";

export type BuilderEnvFilePath = ".env" | ".env.local" | ".env.example";
export type BuilderConfigValueSource = BuilderEnvFilePath | "host_env" | "missing";

export interface BuilderConfigMalformedEntryState {
  path: BuilderEnvFilePath;
  line: number;
  content: string;
  reason: string;
}

export interface BuilderConfigKeyState {
  key: string;
  required: boolean;
  examplePresent: boolean;
  projectValuePresent: boolean;
  executionValuePresent: boolean;
  projectSource: Exclude<BuilderConfigValueSource, "host_env" | "missing"> | null;
  executionSource: BuilderConfigValueSource;
  redactedProjectValue: string | null;
  redactedExecutionValue: string | null;
}

export interface BuilderConfigReadinessState {
  schemaPath: BuilderEnvFilePath | null;
  schemaAvailable: boolean;
  projectReady: boolean;
  executionReady: boolean;
  totalRequiredKeys: number;
  missingProjectKeys: string[];
  missingExecutionKeys: string[];
  malformedEntries: BuilderConfigMalformedEntryState[];
  keys: BuilderConfigKeyState[];
  summary: string;
}

export interface BuilderEnvReadResult {
  key: string;
  projectId?: string;
  source: BuilderConfigValueSource;
  present: boolean;
  redactedValue: string | null;
  value?: string | null;
}

interface ParsedEnvFile {
  path: BuilderEnvFilePath;
  exists: boolean;
  values: Record<string, string>;
  malformedEntries: BuilderConfigMalformedEntryState[];
}

const BUILDER_ENV_FILE_ORDER: BuilderEnvFilePath[] = [".env.local", ".env"];
const BUILDER_ENV_SCHEMA_FILE: BuilderEnvFilePath = ".env.example";
const ENV_ASSIGNMENT_PATTERN = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

function resolveProjectFile(projectRelativePath: string, filePath: BuilderEnvFilePath): string {
  return resolveBuilderWorkspacePath(path.posix.join(projectRelativePath, filePath));
}

function redactEnvValue(value: string | null): string | null {
  if (!value) {
    return value;
  }
  if (value.length <= 4) {
    return "*".repeat(value.length);
  }
  return `${"*".repeat(Math.min(8, value.length - 2))}${value.slice(-2)}`;
}

function parseEnvFile(projectRelativePath: string, filePath: BuilderEnvFilePath): ParsedEnvFile {
  const absolutePath = resolveProjectFile(projectRelativePath, filePath);
  if (!fs.existsSync(absolutePath)) {
    return {
      path: filePath,
      exists: false,
      values: {},
      malformedEntries: [],
    };
  }

  const raw = fs.readFileSync(absolutePath, "utf-8");
  const values = parseDotenv(raw);
  const malformedEntries = raw.split(/\r?\n/).flatMap((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return [];
    }
    if (ENV_ASSIGNMENT_PATTERN.test(trimmed)) {
      return [];
    }
    return [{
      path: filePath,
      line: index + 1,
      content: trimmed,
      reason: "Line is not a valid KEY=value entry.",
    } satisfies BuilderConfigMalformedEntryState];
  });

  return {
    path: filePath,
    exists: true,
    values,
    malformedEntries,
  };
}

function collectProjectEnvFiles(projectRelativePath: string): {
  schema: ParsedEnvFile;
  projectFiles: ParsedEnvFile[];
} {
  return {
    schema: parseEnvFile(projectRelativePath, BUILDER_ENV_SCHEMA_FILE),
    projectFiles: BUILDER_ENV_FILE_ORDER.map((filePath) => parseEnvFile(projectRelativePath, filePath)),
  };
}

function summarizeConfigReadiness(args: {
  totalRequiredKeys: number;
  missingProjectKeys: string[];
  missingExecutionKeys: string[];
  malformedEntries: BuilderConfigMalformedEntryState[];
  schemaAvailable: boolean;
}): string {
  if (!args.schemaAvailable) {
    return "No .env.example schema is present yet.";
  }
  if (args.malformedEntries.length > 0) {
    return `Config has ${args.malformedEntries.length} malformed env entr${args.malformedEntries.length === 1 ? "y" : "ies"}.`;
  }
  if (args.missingExecutionKeys.length > 0) {
    return `Execution is blocked by missing env keys: ${args.missingExecutionKeys.join(", ")}.`;
  }
  if (args.missingProjectKeys.length > 0) {
    return `Execution can rely on host env, but project-local env files are missing: ${args.missingProjectKeys.join(", ")}.`;
  }
  if (args.totalRequiredKeys === 0) {
    return "No required env keys were declared in .env.example.";
  }
  return `Config ready with ${args.totalRequiredKeys} required env key${args.totalRequiredKeys === 1 ? "" : "s"}.`;
}

function appendEnvironmentAuditEvent(args: BuilderCapabilityAuditContext & {
  projectRelativePath: string;
  outcomeStatus: "succeeded" | "failed" | "blocked";
  targets: Array<{ identifier: string; metadata?: Record<string, unknown> }>;
  metadata?: Record<string, unknown>;
}): string {
  return appendBuilderCapabilityAuditEvent({
    capabilityKey: "environment_configuration",
    projectRelativePath: args.projectRelativePath,
    projectId: args.projectId,
    taskId: args.taskId,
    runId: args.runId,
    outcomeStatus: args.outcomeStatus,
    targets: args.targets.map((target) => ({ kind: "environment", identifier: target.identifier, metadata: target.metadata })),
    metadata: args.metadata,
  }).auditPath;
}

function throwEnvironmentMutationBlocked(args: BuilderCapabilityAuditContext & {
  projectRelativePath: string;
  message: string;
  targets: Array<{ identifier: string; metadata?: Record<string, unknown> }>;
  metadata?: Record<string, unknown>;
}): never {
  const auditPath = appendEnvironmentAuditEvent({
    ...args,
    outcomeStatus: "blocked",
  });
  throw new Error(`${args.message} Audit: ${auditPath}`);
}

export function getBuilderEnvSchema(projectRelativePath: string, auditContext?: BuilderCapabilityAuditContext): { path: BuilderEnvFilePath | null; keys: string[]; auditPath: string } {
  const { schema } = collectProjectEnvFiles(projectRelativePath);
  const keys = Object.keys(schema.values).sort();
  const auditPath = appendEnvironmentAuditEvent({
    ...auditContext,
    projectRelativePath,
    outcomeStatus: "succeeded",
    targets: [{ identifier: BUILDER_ENV_SCHEMA_FILE }],
    metadata: { operation: "get_env_schema", totalKeys: keys.length, schemaAvailable: schema.exists },
  });
  return {
    path: schema.exists ? BUILDER_ENV_SCHEMA_FILE : null,
    keys,
    auditPath,
  };
}

export function listBuilderRequiredConfig(projectRelativePath: string, auditContext?: BuilderCapabilityAuditContext): { keys: string[]; auditPath: string } {
  const schema = getBuilderEnvSchema(projectRelativePath, auditContext);
  return {
    keys: schema.keys,
    auditPath: schema.auditPath,
  };
}

export function validateBuilderProjectEnv(projectRelativePath: string, auditContext?: BuilderCapabilityAuditContext): BuilderConfigReadinessState & { auditPath: string } {
  const { schema, projectFiles } = collectProjectEnvFiles(projectRelativePath);
  const requiredKeys = Object.keys(schema.values).sort();
  const malformedEntries = [schema, ...projectFiles].flatMap((file) => file.malformedEntries);

  const keys = requiredKeys.map((key) => {
    const projectMatch = projectFiles.find((file) => Object.prototype.hasOwnProperty.call(file.values, key));
    const hostValue = process.env[key];
    const projectValue = projectMatch?.values[key] ?? null;
    const executionValue = projectValue ?? hostValue ?? null;
    const projectSource = projectMatch?.path ?? null;
    const executionSource: BuilderConfigValueSource = projectValue !== null
      ? (projectMatch?.path ?? "missing")
      : typeof hostValue === "string"
        ? "host_env"
        : "missing";

    return {
      key,
      required: true,
      examplePresent: Object.prototype.hasOwnProperty.call(schema.values, key),
      projectValuePresent: projectValue !== null,
      executionValuePresent: executionValue !== null,
      projectSource,
      executionSource,
      redactedProjectValue: redactEnvValue(projectValue),
      redactedExecutionValue: redactEnvValue(executionValue),
    } satisfies BuilderConfigKeyState;
  });

  const missingProjectKeys = keys.filter((entry) => !entry.projectValuePresent).map((entry) => entry.key);
  const missingExecutionKeys = keys.filter((entry) => !entry.executionValuePresent).map((entry) => entry.key);
  const auditPath = appendEnvironmentAuditEvent({
    ...auditContext,
    projectRelativePath,
    outcomeStatus: "succeeded",
    targets: [
      { identifier: BUILDER_ENV_SCHEMA_FILE },
      { identifier: ".env" },
      { identifier: ".env.local" },
    ],
    metadata: {
      operation: "validate_env",
      schemaAvailable: schema.exists,
      totalRequiredKeys: requiredKeys.length,
      missingProjectKeys,
      missingExecutionKeys,
      malformedEntryCount: malformedEntries.length,
    },
  });

  return {
    schemaPath: schema.exists ? BUILDER_ENV_SCHEMA_FILE : null,
    schemaAvailable: schema.exists,
    projectReady: schema.exists && missingProjectKeys.length === 0 && malformedEntries.length === 0,
    executionReady: schema.exists && missingExecutionKeys.length === 0 && malformedEntries.length === 0,
    totalRequiredKeys: requiredKeys.length,
    missingProjectKeys,
    missingExecutionKeys,
    malformedEntries,
    keys,
    auditPath,
    summary: summarizeConfigReadiness({
      totalRequiredKeys: requiredKeys.length,
      missingProjectKeys,
      missingExecutionKeys,
      malformedEntries,
      schemaAvailable: schema.exists,
    }),
  };
}

export function readBuilderProjectEnvValue(projectRelativePath: string, key: string, options?: { reveal?: boolean }, auditContext?: BuilderCapabilityAuditContext): BuilderEnvReadResult & { auditPath: string } {
  const normalizedKey = key.trim();
  if (!normalizedKey) {
    throw new Error("Environment key is required.");
  }

  const { projectFiles } = collectProjectEnvFiles(projectRelativePath);
  const projectMatch = projectFiles.find((file) => Object.prototype.hasOwnProperty.call(file.values, normalizedKey));
  const projectValue = projectMatch?.values[normalizedKey] ?? null;
  const hostValue = process.env[normalizedKey];
  const resolvedValue = projectValue ?? hostValue ?? null;
  const source: BuilderConfigValueSource = projectValue !== null
    ? (projectMatch?.path ?? "missing")
    : typeof hostValue === "string"
      ? "host_env"
      : "missing";
  const auditPath = appendEnvironmentAuditEvent({
    ...auditContext,
    projectRelativePath,
    outcomeStatus: "succeeded",
    targets: [{ identifier: normalizedKey }],
    metadata: { operation: "read_env_value", source, present: resolvedValue !== null, revealed: Boolean(options?.reveal) },
  });

  return {
    key: normalizedKey,
    source,
    present: resolvedValue !== null,
    redactedValue: redactEnvValue(resolvedValue),
    auditPath,
    ...(options?.reveal ? { value: resolvedValue } : {}),
  };
}

function quoteEnvValue(value: string): string {
  return /\s|#|"/.test(value)
    ? JSON.stringify(value)
    : value;
}

export function writeBuilderProjectEnvFileEntry(projectRelativePath: string, args: {
  key: string;
  value: string;
  file?: Extract<BuilderEnvFilePath, ".env" | ".env.local">;
}, auditContext?: BuilderCapabilityAuditContext): { path: BuilderEnvFilePath; key: string; redactedValue: string; auditPath: string } {
  const key = args.key.trim();
  if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throwEnvironmentMutationBlocked({
      ...auditContext,
      projectRelativePath,
      message: "Environment key must be a valid shell identifier.",
      targets: [{ identifier: args.file ?? ".env.local" }, { identifier: key || "<empty>" }],
      metadata: { operation: "write_env_file_entry", reason: "invalid_key", attemptedKey: args.key },
    });
  }

  const targetFile = args.file ?? ".env.local";
  const absolutePath = resolveProjectFile(projectRelativePath, targetFile);
  const existing = fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, "utf-8") : "";
  const lines = existing.length > 0 ? existing.split(/\r?\n/) : [];
  const rendered = `${key}=${quoteEnvValue(args.value)}`;
  const nextLines = (() => {
    let replaced = false;
    const updatedLines = lines.map((line) => {
      if (!ENV_ASSIGNMENT_PATTERN.test(line.trim())) {
        return line;
      }
      const match = line.trim().match(ENV_ASSIGNMENT_PATTERN);
      if (match?.[1] === key) {
        replaced = true;
        return rendered;
      }
      return line;
    });
    if (!replaced) {
      updatedLines.push(rendered);
    }
    return updatedLines;
  })();

  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${nextLines.filter((line, index, source) => !(index === source.length - 1 && line === "")).join("\n")}\n`, "utf-8");
  const auditPath = appendEnvironmentAuditEvent({
    ...auditContext,
    projectRelativePath,
    outcomeStatus: "succeeded",
    targets: [{ identifier: targetFile }, { identifier: key }],
    metadata: { operation: "write_env_file_entry", file: targetFile, key },
  });
  return {
    path: targetFile,
    key,
    redactedValue: redactEnvValue(args.value) ?? "",
    auditPath,
  };
}

export function syncBuilderProjectEnvExample(projectRelativePath: string): {
  path: BuilderEnvFilePath;
  addedKeys: string[];
  totalKeys: number;
  auditPath: string;
} {
  const { schema, projectFiles } = collectProjectEnvFiles(projectRelativePath);
  const allKeys = new Set<string>(Object.keys(schema.values));
  for (const file of projectFiles) {
    for (const key of Object.keys(file.values)) {
      allKeys.add(key);
    }
  }

  const sortedKeys = [...allKeys].sort();
  const existingKeys = new Set(Object.keys(schema.values));
  const addedKeys = sortedKeys.filter((key) => !existingKeys.has(key));
  const absolutePath = resolveProjectFile(projectRelativePath, BUILDER_ENV_SCHEMA_FILE);
  const lines = sortedKeys.map((key) => `${key}=`);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${lines.join("\n")}\n`, "utf-8");
  const auditPath = appendEnvironmentAuditEvent({
    projectRelativePath,
    outcomeStatus: "succeeded",
    targets: [{ identifier: BUILDER_ENV_SCHEMA_FILE }],
    metadata: { operation: "sync_env_example", addedKeys, totalKeys: sortedKeys.length },
  });
  return {
    path: BUILDER_ENV_SCHEMA_FILE,
    addedKeys,
    totalKeys: sortedKeys.length,
    auditPath,
  };
}