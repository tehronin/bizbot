/**
 * GET   /api/onboarding  – check if onboarding is complete
 * POST  /api/onboarding  – mark onboarding complete or advance step
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db";

const ONBOARDING_SETTING = "onboarding_completed";
const ONBOARDING_STEP_SETTING = "onboarding_step";

export async function GET() {
  const [completedRow, stepRow] = await Promise.all([
    db.setting.findUnique({ where: { key: ONBOARDING_SETTING } }),
    db.setting.findUnique({ where: { key: ONBOARDING_STEP_SETTING } }),
  ]);
  const completed = completedRow?.value === "true";
  return Response.json({ completed, step: stepRow?.value ?? null });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { completed?: boolean; step?: string };
    if (body.completed) {
      await db.setting.upsert({
        where: { key: ONBOARDING_SETTING },
        update: { value: "true" },
        create: { key: ONBOARDING_SETTING, value: "true" },
      });
    }
    if (body.step) {
      await db.setting.upsert({
        where: { key: "onboarding_step" },
        update: { value: body.step },
        create: { key: "onboarding_step", value: body.step },
      });
    }
    return Response.json({ updated: true });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
