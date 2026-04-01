import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import type { BuilderCliProfile, Prisma } from "@prisma/client";
import { db } from "@/lib/db";

const PROFILE_HEALTH_CACHE_TTL_MS = 60_000;

export interface BuilderCliProfileDefinition {
  key: string;
  displayName: string;
  command: string;
  description: string;
  enabled: boolean;
  supportsNonInteractive: boolean;
  metadata?: Prisma.InputJsonValue;
}

type ProfileHealthSnapshot = {
  healthy: boolean;
  healthReason: string | null;
  checkedAt: string;
};

type ProfileAuthSnapshot = {
  authReady: boolean;
  authReason: string | null;
};

const profileHealthCache = new Map<string, { expiresAt: number; snapshot: ProfileHealthSnapshot }>();

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function resolveCommandOnPath(command: string): string | null {
  const trimmed = command.trim();
  if (!trimmed) {
    return null;
  }

  const candidateNames = process.platform === "win32"
    ? Array.from(new Set([
      trimmed,
      ...((process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM")
        .split(path.delimiter)
        .filter(Boolean)
        .map((ext) => trimmed.toLowerCase().endsWith(ext.toLowerCase()) ? trimmed : `${trimmed}${ext}`)),
    ]))
    : [trimmed];

  if (path.isAbsolute(trimmed)) {
    return candidateNames.find((candidate) => fs.existsSync(candidate)) ?? null;
  }

  const pathEntries = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const entry of pathEntries) {
    for (const candidateName of candidateNames) {
      const absolutePath = path.join(entry, candidateName);
      if (fs.existsSync(absolutePath)) {
        return absolutePath;
      }
    }
  }

  return null;
}

function probeCommandHealth(cacheKey: string, commandPath: string, args: string[]): ProfileHealthSnapshot {
  const cached = profileHealthCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.snapshot;
  }

  const checkedAt = new Date().toISOString();
  const useWindowsCommandShim = process.platform === "win32" && /\.(cmd|bat)$/i.test(commandPath);

  try {
    const result = spawnSync(
      useWindowsCommandShim ? "cmd.exe" : commandPath,
      useWindowsCommandShim ? ["/d", "/s", "/c", commandPath, ...args] : args,
      {
      timeout: 5_000,
      windowsHide: true,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      },
    );

    const snapshot: ProfileHealthSnapshot = result.status === 0
      ? { healthy: true, healthReason: null, checkedAt }
      : {
          healthy: false,
          healthReason: result.error
            ? `Health check failed: ${String(result.error)}`
            : `Health check exited with code ${result.status ?? "unknown"}.`,
          checkedAt,
        };

    profileHealthCache.set(cacheKey, { expiresAt: Date.now() + PROFILE_HEALTH_CACHE_TTL_MS, snapshot });
    return snapshot;
  } catch (error) {
    const snapshot: ProfileHealthSnapshot = {
      healthy: false,
      healthReason: `Health check failed: ${String(error)}`,
      checkedAt,
    };
    profileHealthCache.set(cacheKey, { expiresAt: Date.now() + PROFILE_HEALTH_CACHE_TTL_MS, snapshot });
    return snapshot;
  }
}

function getProfileHealthSnapshot(profileKey: string, resolvedCommand: string | null): ProfileHealthSnapshot {
  if (!resolvedCommand) {
    return {
      healthy: false,
      healthReason: "Command is not available on PATH.",
      checkedAt: new Date().toISOString(),
    };
  }

  switch (profileKey) {
    case "codex":
      return probeCommandHealth(`codex:${resolvedCommand}`, resolvedCommand, ["exec", "--help"]);
    case "claude-code":
      return probeCommandHealth(`claude-code:${resolvedCommand}`, resolvedCommand, ["--help"]);
    default:
      return {
        healthy: false,
        healthReason: "No health check is defined for this Builder CLI profile.",
        checkedAt: new Date().toISOString(),
      };
  }
}

function getProfileAuthSnapshot(profileKey: string): ProfileAuthSnapshot {
  switch (profileKey) {
    case "codex":
      return process.env.OPENAI_API_KEY?.trim()
        ? { authReady: true, authReason: null }
        : { authReady: false, authReason: "OPENAI_API_KEY is not configured for the Codex adapter." };
    case "claude-code":
      return process.env.ANTHROPIC_API_KEY?.trim()
        ? { authReady: true, authReason: null }
        : { authReady: false, authReason: "ANTHROPIC_API_KEY is not configured for the Claude Code adapter." };
    default:
      return { authReady: false, authReason: "No authentication readiness rule is defined for this Builder CLI profile." };
  }
}

function buildReadinessReason(args: {
  enabled: boolean;
  available: boolean;
  availabilityReason: string | null;
  healthy: boolean;
  healthReason: string | null;
  authReady: boolean;
  authReason: string | null;
}): string {
  if (!args.enabled) {
    return "Adapter is disabled and remains dormant scaffolding until explicitly enabled.";
  }
  if (!args.available) {
    return args.availabilityReason ?? "Adapter command is unavailable.";
  }
  if (!args.healthy) {
    return args.healthReason ?? "Adapter health check failed.";
  }
  if (!args.authReady) {
    return args.authReason ?? "Adapter authentication is not configured.";
  }

  return "Ready for Builder agentic execution.";
}

function buildProfileDefinitions(): BuilderCliProfileDefinition[] {
  const codexCommand = process.env.BIZBOT_BUILDER_CODEX_COMMAND?.trim() || "codex";
  const claudeCommand = process.env.BIZBOT_BUILDER_CLAUDE_CODE_COMMAND?.trim() || "claude";
  const codexResolved = resolveCommandOnPath(codexCommand);
  const claudeResolved = resolveCommandOnPath(claudeCommand);
  const codexEnabled = parseBoolean(process.env.BIZBOT_BUILDER_CODEX_ENABLED, false);
  const claudeEnabled = parseBoolean(process.env.BIZBOT_BUILDER_CLAUDE_CODE_ENABLED, false);
  const codexHealth = getProfileHealthSnapshot("codex", codexResolved);
  const claudeHealth = getProfileHealthSnapshot("claude-code", claudeResolved);
  const codexAuth = getProfileAuthSnapshot("codex");
  const claudeAuth = getProfileAuthSnapshot("claude-code");

  return [
    {
      key: "codex",
      displayName: "Codex CLI",
      command: codexCommand,
      description: "Dormant Builder adapter scaffold for Codex. Keep disabled unless the CLI contract and auth path are intentionally validated here.",
      enabled: codexEnabled,
      supportsNonInteractive: true,
      metadata: {
        available: codexResolved !== null,
        resolvedCommand: codexResolved,
        availabilityReason: codexResolved ? null : `Command not found on PATH: ${codexCommand}`,
        healthy: codexHealth.healthy,
        healthReason: codexHealth.healthReason,
        healthCheckedAt: codexHealth.checkedAt,
        authReady: codexAuth.authReady,
        authReason: codexAuth.authReason,
        ready: codexEnabled && codexResolved !== null && codexHealth.healthy && codexAuth.authReady,
        readinessReason: buildReadinessReason({
          enabled: codexEnabled,
          available: codexResolved !== null,
          availabilityReason: codexResolved ? null : `Command not found on PATH: ${codexCommand}`,
          healthy: codexHealth.healthy,
          healthReason: codexHealth.healthReason,
          authReady: codexAuth.authReady,
          authReason: codexAuth.authReason,
        }),
        commandSource: process.env.BIZBOT_BUILDER_CODEX_COMMAND?.trim() ? "env" : "default",
        platform: process.platform,
      },
    },
    {
      key: "claude-code",
      displayName: "Claude Code",
      command: claudeCommand,
      description: "Dormant Builder adapter scaffold for Claude Code. Keep disabled until a stable non-interactive contract is intentionally wired here.",
      enabled: claudeEnabled,
      supportsNonInteractive: true,
      metadata: {
        available: claudeResolved !== null,
        resolvedCommand: claudeResolved,
        availabilityReason: claudeResolved ? null : `Command not found on PATH: ${claudeCommand}`,
        healthy: claudeHealth.healthy,
        healthReason: claudeHealth.healthReason,
        healthCheckedAt: claudeHealth.checkedAt,
        authReady: claudeAuth.authReady,
        authReason: claudeAuth.authReason,
        ready: claudeEnabled && claudeResolved !== null && claudeHealth.healthy && claudeAuth.authReady,
        readinessReason: buildReadinessReason({
          enabled: claudeEnabled,
          available: claudeResolved !== null,
          availabilityReason: claudeResolved ? null : `Command not found on PATH: ${claudeCommand}`,
          healthy: claudeHealth.healthy,
          healthReason: claudeHealth.healthReason,
          authReady: claudeAuth.authReady,
          authReason: claudeAuth.authReason,
        }),
        commandSource: process.env.BIZBOT_BUILDER_CLAUDE_CODE_COMMAND?.trim() ? "env" : "default",
        platform: process.platform,
      },
    },
  ];
}

export async function syncBuilderCliProfiles(): Promise<BuilderCliProfile[]> {
  const profiles = buildProfileDefinitions();
  await Promise.all(
    profiles.map((profile) =>
      db.builderCliProfile.upsert({
        where: { key: profile.key },
        update: {
          displayName: profile.displayName,
          command: profile.command,
          description: profile.description,
          enabled: profile.enabled,
          supportsNonInteractive: profile.supportsNonInteractive,
          metadata: profile.metadata,
        },
        create: {
          key: profile.key,
          displayName: profile.displayName,
          command: profile.command,
          description: profile.description,
          enabled: profile.enabled,
          supportsNonInteractive: profile.supportsNonInteractive,
          metadata: profile.metadata,
        },
      }),
    ),
  );

  return db.builderCliProfile.findMany({ orderBy: { displayName: "asc" } });
}

export async function getBuilderCliProfile(key: string): Promise<BuilderCliProfile> {
  await syncBuilderCliProfiles();
  const profile = await db.builderCliProfile.findUnique({ where: { key } });
  if (!profile) {
    throw new Error(`Builder CLI profile not found: ${key}`);
  }

  return profile;
}
