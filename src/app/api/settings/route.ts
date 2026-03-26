/**
 * GET   /api/settings  – read all settings + masked env values
 * PATCH /api/settings  – update settings or env vars
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { readEnv, writeEnv, maskEnvValues } from "@/lib/env";

export async function GET() {
  const settings = await db.setting.findMany();
  const raw = await readEnv();
  return Response.json({ settings, env: maskEnvValues(raw) });
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
      await writeEnv(body.env);
    }

    return Response.json({ updated: true });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
