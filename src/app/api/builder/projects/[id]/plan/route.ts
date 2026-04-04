import { NextRequest } from "next/server";
import { planBuilderProject } from "@/lib/builder/orchestrator";

function parsePlanPayload(value: object | null): {
  title?: string;
  summary?: string;
  goals?: string[];
  constraints?: string[];
  deliverables?: string[];
  notes?: string;
  regenerate?: boolean;
} {
  if (!value || Array.isArray(value)) {
    return {};
  }

  const candidate = value as Record<string, unknown>;
  const readStringArray = (input: unknown): string[] | undefined => Array.isArray(input)
    ? input.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim()] : [])
    : undefined;

  return {
    title: typeof candidate.title === "string" ? candidate.title : undefined,
    summary: typeof candidate.summary === "string" ? candidate.summary : undefined,
    goals: readStringArray(candidate.goals),
    constraints: readStringArray(candidate.constraints),
    deliverables: readStringArray(candidate.deliverables),
    notes: typeof candidate.notes === "string" ? candidate.notes : undefined,
    regenerate: typeof candidate.regenerate === "boolean" ? candidate.regenerate : undefined,
  };
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const overview = await planBuilderProject(id, parsePlanPayload(await req.json().catch(() => null)) as never);
    return Response.json(overview);
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}