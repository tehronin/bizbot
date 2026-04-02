/**
 * GET   /api/settings  – read all settings + masked env values
 * PATCH /api/settings  – update settings or env vars
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { readEnv, writeEnv, maskEnvValues } from "@/lib/env";
import { filterVisibleSettings, saveEncryptedSecrets } from "@/lib/runtime-secrets";

const LEGACY_MINIMAX_MODEL = "abab6.5s-chat";
const DEFAULT_MINIMAX_MODEL = "MiniMax-M2.7";

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
    const body = (await req.json()) as {
      settings?: Array<{ key: string; value: string }>;
      env?: Record<string, string>;
    };

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
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
