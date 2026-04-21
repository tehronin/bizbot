/**
 * GET   /api/settings  – read all settings + masked env values
 * PATCH /api/settings  – update settings or env vars
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { readEnv, writeEnv, maskEnvValues } from "@/lib/env";
import { filterVisibleSettings, isManagedSecretEnvKey, saveEncryptedSecrets } from "@/lib/runtime-secrets";
import { ApiRouteError, apiErrorResponse } from "@/lib/api/errors";

const LEGACY_MINIMAX_MODEL = "abab6.5s-chat";
const DEFAULT_MINIMAX_MODEL = "MiniMax-M2.7";
const MAX_ENV_VALUE_LENGTH = 8_192;
const ALLOWED_PUBLIC_ENV_KEYS = new Set([
  "ACTIVE_LLM_PROVIDER",
  "OPENAI_MODEL",
  "ANTHROPIC_MODEL",
  "OLLAMA_MODEL",
  "OLLAMA_BASE_URL",
  "GOOGLE_MODEL",
  "EMBEDDING_PROVIDER",
  "EMBEDDING_MODEL",
  "EMBEDDING_DIMENSIONS",
  "LLM_TEMPERATURE",
  "LLM_MAX_TOKENS",
  "BIZBOT_AGENT_MAX_TOOL_RESULT_CHARS",
  "GOOGLE_MAX_OUTPUT_TOKENS",
  "GOOGLE_CONTEXT_MODE",
  "GOOGLE_MAX_TOOL_RESULT_CHARS",
  "MINIMAX_MODEL",
  "MINIMAX_BASE_URL",
  "BIZBOT_AUTONOMY_PRESET",
  "BIZBOT_AGENT_HEARTBEAT_SECONDS",
  "BIZBOT_DEV_WEB_CONFLICT",
  "BIZBOT_KNOWLEDGE_ENABLED",
  "BIZBOT_KNOWLEDGE_PATH",
  "BIZBOT_WORKSPACE_PATH",
  "BIZBOT_PROCESS_WEBHOOK_INBOX_IMMEDIATELY",
  "BIZBOT_BUILDER_WORKSPACE_PATH",
  "BIZBOT_BUILDER_ALLOWED_COMMANDS",
  "BIZBOT_BUILDER_DEFAULT_TEMPLATE",
  "BIZBOT_BUILDER_DEFAULT_PACKAGE_MANAGER",
  "BIZBOT_BUILDER_INIT_GIT",
  "BIZBOT_BUILDER_INSTALL_DEPS",
  "BIZBOT_BUILDER_DEFAULT_AGENTIC_PROFILE",
  "BIZBOT_BUILDER_AGENTIC_TIMEOUT_SECONDS",
  "BIZBOT_BUILDER_CODEX_ENABLED",
  "BIZBOT_BUILDER_CODEX_COMMAND",
  "BIZBOT_BUILDER_CODEX_MODEL",
  "BIZBOT_BUILDER_CLAUDE_CODE_ENABLED",
  "BIZBOT_BUILDER_CLAUDE_CODE_COMMAND",
  "BIZBOT_CONVERSATION_BRIDGE_ENABLED",
  "CRM_PROVIDER",
  "HUBSPOT_PORTAL_ID",
  "HUBSPOT_BASE_URL",
  "MCP_SERVERS",
  "REDIS_URL",
  "MEMGRAPH_URI",
  "MEMGRAPH_USER",
  "GOOGLE_BUSINESS_ACCOUNT_NAME",
  "GOOGLE_BUSINESS_LOCATION_NAME",
  "GOOGLE_BUSINESS_INFO_LOCATION_NAME",
  "TWITTER_USER_ID",
  "FACEBOOK_PAGE_ID",
  "META_PAGE_ID",
  "INSTAGRAM_BUSINESS_ACCOUNT_ID",
  "META_INSTAGRAM_ACCOUNT_ID",
]);

function applyEnvUpdatesToProcessEnv(env: Record<string, string>): void {
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }
}

function normalizeEnvSettings(env: Record<string, string>): { env: Record<string, string>; changed: boolean } {
  if (env.MINIMAX_MODEL !== LEGACY_MINIMAX_MODEL) {
    return { env, changed: false };
  }

  return {
    env: {
      ...env,
      MINIMAX_MODEL: DEFAULT_MINIMAX_MODEL,
    },
    changed: true,
  };
}

function parseSettingsPatchBody(value: unknown): {
  settings?: Array<{ key: string; value: string }>;
  env?: Record<string, string>;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiRouteError(400, "invalid_settings_payload", "Invalid settings payload.");
  }

  const candidate = value as {
    settings?: unknown;
    env?: unknown;
  };

  let settings: Array<{ key: string; value: string }> | undefined;
  if (candidate.settings !== undefined) {
    if (!Array.isArray(candidate.settings)) {
      throw new ApiRouteError(400, "invalid_settings_payload", "settings must be an array.");
    }

    settings = candidate.settings.map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new ApiRouteError(400, "invalid_settings_payload", "Each setting must be an object.");
      }

      const item = entry as { key?: unknown; value?: unknown };
      if (typeof item.key !== "string" || item.key.trim().length === 0 || typeof item.value !== "string") {
        throw new ApiRouteError(400, "invalid_settings_entry", "Each setting requires string key and value.");
      }

      return {
        key: item.key.trim(),
        value: item.value,
      };
    });
  }

  let env: Record<string, string> | undefined;
  if (candidate.env !== undefined) {
    if (!candidate.env || typeof candidate.env !== "object" || Array.isArray(candidate.env)) {
      throw new ApiRouteError(400, "invalid_settings_payload", "env must be an object.");
    }

    env = {};
    for (const [rawKey, rawValue] of Object.entries(candidate.env)) {
      const key = rawKey.trim();
      if (!key || (!ALLOWED_PUBLIC_ENV_KEYS.has(key) && !isManagedSecretEnvKey(key))) {
        throw new ApiRouteError(400, "unknown_env_key", `Unknown env key: ${rawKey}`);
      }
      if (typeof rawValue !== "string") {
        throw new ApiRouteError(400, "invalid_env_value", `Env value for ${key} must be a string.`);
      }
      if (rawValue.length > MAX_ENV_VALUE_LENGTH) {
        throw new ApiRouteError(400, "env_value_too_large", `Env value for ${key} is too large.`);
      }

      env[key] = rawValue;
    }
  }

  return { settings, env };
}

export async function GET() {
  const settings = filterVisibleSettings(await db.setting.findMany());
  const raw = await readEnv();
  const normalized = normalizeEnvSettings(raw);

  if (normalized.changed) {
    await writeEnv(normalized.env);
    applyEnvUpdatesToProcessEnv(normalized.env);
  }

  return Response.json({ settings, env: maskEnvValues(normalized.env) });
}

export async function PATCH(req: NextRequest) {
  try {
    const body = parseSettingsPatchBody(await req.json());

    if (body.settings) {
      await Promise.all(
        body.settings.map((s) =>
          db.setting.upsert({
            where: { key: s.key },
            update: { value: s.value },
            create: { key: s.key, value: s.value },
          }),
        ),
      );
    }

    if (body.env) {
      const normalized = normalizeEnvSettings(body.env);
      await writeEnv(normalized.env);
      applyEnvUpdatesToProcessEnv(normalized.env);
      await saveEncryptedSecrets(normalized.env);
    }

    return Response.json({ updated: true });
  } catch (err) {
    return apiErrorResponse(err, "[api/settings] PATCH failed");
  }
}
