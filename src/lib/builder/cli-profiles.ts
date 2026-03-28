import fs from "fs";
import path from "path";
import type { BuilderCliProfile, Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export interface BuilderCliProfileDefinition {
  key: string;
  displayName: string;
  command: string;
  description: string;
  enabled: boolean;
  supportsNonInteractive: boolean;
  metadata?: Prisma.InputJsonValue;
}

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

function buildProfileDefinitions(): BuilderCliProfileDefinition[] {
  const codexCommand = process.env.BIZBOT_BUILDER_CODEX_COMMAND?.trim() || "codex";
  const claudeCommand = process.env.BIZBOT_BUILDER_CLAUDE_CODE_COMMAND?.trim() || "claude";
  const codexResolved = resolveCommandOnPath(codexCommand);
  const claudeResolved = resolveCommandOnPath(claudeCommand);

  return [
    {
      key: "codex",
      displayName: "Codex CLI",
      command: codexCommand,
      description: "Run Codex in non-interactive Builder Mode with project-scoped workspace-write permissions.",
      enabled: parseBoolean(process.env.BIZBOT_BUILDER_CODEX_ENABLED, false),
      supportsNonInteractive: true,
      metadata: {
        available: codexResolved !== null,
        resolvedCommand: codexResolved,
        availabilityReason: codexResolved ? null : `Command not found on PATH: ${codexCommand}`,
        commandSource: process.env.BIZBOT_BUILDER_CODEX_COMMAND?.trim() ? "env" : "default",
        platform: process.platform,
      },
    },
    {
      key: "claude-code",
      displayName: "Claude Code",
      command: claudeCommand,
      description: "Reserved Builder Mode adapter slot for Claude Code once a stable non-interactive contract is enabled here.",
      enabled: parseBoolean(process.env.BIZBOT_BUILDER_CLAUDE_CODE_ENABLED, false),
      supportsNonInteractive: true,
      metadata: {
        available: claudeResolved !== null,
        resolvedCommand: claudeResolved,
        availabilityReason: claudeResolved ? null : `Command not found on PATH: ${claudeCommand}`,
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