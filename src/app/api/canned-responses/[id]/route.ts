import { NextRequest } from "next/server";
import { isJsonValue, type JsonValue } from "@/lib/agent/tools";
import { updateCannedResponseTree } from "@/lib/inbox/canned-responses";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = await req.json();
    if (!isRecord(body)) {
      return Response.json({ error: "Invalid canned response tree payload." }, { status: 400 });
    }

    const tree = await updateCannedResponseTree(id, {
      ...(typeof body.name === "string" ? { name: body.name } : {}),
      ...(typeof body.description === "string" || body.description === null
        ? { description: body.description as string | null }
        : {}),
      ...(typeof body.active === "boolean" ? { active: body.active } : {}),
      ...(typeof body.rootNodeKey === "string" ? { rootNodeKey: body.rootNodeKey } : {}),
      ...(body.nodes !== undefined && isJsonValue(body.nodes as JsonValue | object | null | undefined)
        ? { nodes: body.nodes as JsonValue }
        : {}),
      ...(body.matchRules !== undefined && isJsonValue(body.matchRules as JsonValue | object | null | undefined)
        ? { matchRules: body.matchRules as JsonValue }
        : {}),
    });

    return Response.json({ tree });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}