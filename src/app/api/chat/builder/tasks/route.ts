import { NextRequest } from "next/server";
import { launchBuilderTaskFromChat } from "@/lib/builder/interactions";
import { formatBuilderUserFacingError } from "@/lib/builder/user-facing";
import { resolveAgentUserId } from "@/lib/agent/user-context";

function parseBody(value: unknown): {
  conversationId?: string | null;
  projectId: string;
  request: string;
  retryFailed?: boolean;
  taskId?: string | null;
  profile?: string;
  model?: string;
  userId?: string | null;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid Builder task payload.");
  }

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.projectId !== "string" || !candidate.projectId.trim()) {
    throw new Error("Builder task payload requires projectId.");
  }
  if (typeof candidate.request !== "string" || !candidate.request.trim()) {
    throw new Error("Builder task request is required.");
  }

  return {
    conversationId: typeof candidate.conversationId === "string" ? candidate.conversationId : null,
    projectId: candidate.projectId.trim(),
    request: candidate.request,
    retryFailed: typeof candidate.retryFailed === "boolean" ? candidate.retryFailed : undefined,
    taskId: typeof candidate.taskId === "string" ? candidate.taskId : null,
    profile: typeof candidate.profile === "string" ? candidate.profile : undefined,
    model: typeof candidate.model === "string" ? candidate.model : undefined,
    userId: typeof candidate.userId === "string" ? candidate.userId : null,
  };
}

export async function POST(req: NextRequest) {
  try {
    const payload = parseBody(await req.json());
    const result = await launchBuilderTaskFromChat({
      ...payload,
      userId: resolveAgentUserId(payload.userId),
    });

    return Response.json(result, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: formatBuilderUserFacingError(message) }, { status: 500 });
  }
}
