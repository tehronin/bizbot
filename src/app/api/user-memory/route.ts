import { NextRequest } from "next/server";
import {
  forgetMemoryFact,
  getActiveMemoryFacts,
  setMemoryFact,
} from "@/lib/agent/memory/service";
import { resolveAgentUserId } from "@/lib/agent/user-context";
import { ApiRouteError, apiErrorResponse } from "@/lib/api/errors";

function listValues(searchParams: URLSearchParams, key: string): string[] | undefined {
  const values = searchParams.getAll(key)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);

  return values.length > 0 ? values : undefined;
}

function resolveRequestUserId(userId?: string | null): string {
  const effectiveUserId = resolveAgentUserId();
  const requestedUserId = typeof userId === "string" ? userId.trim() : "";

  if (requestedUserId.length > 0 && requestedUserId !== effectiveUserId) {
    throw new ApiRouteError(403, "user_id_override_not_allowed", "Explicit userId overrides are not allowed.");
  }

  return effectiveUserId;
}

function isClientMemoryError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /required|Unsupported memory fact|Memory fact|Refusing to store secrets/i.test(error.message);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Invalid memory payload.";
}

export async function GET(req: NextRequest) {
  try {
    const userId = resolveRequestUserId(req.nextUrl.searchParams.get("userId"));
    const categories = listValues(req.nextUrl.searchParams, "category");
    const keys = listValues(req.nextUrl.searchParams, "key");

    const facts = await getActiveMemoryFacts({
      userId,
      categories: categories as never,
      keys,
    });

    return Response.json({ userId, facts });
  } catch (error) {
    return apiErrorResponse(error, "[api/user-memory] GET failed");
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      userId?: string;
      category?: string;
      key?: string;
      value?: unknown;
      source?: string;
    };

    if (typeof body.category !== "string" || typeof body.key !== "string" || body.value === undefined) {
      throw new ApiRouteError(400, "invalid_memory_payload", "category, key, and value are required.");
    }

    const fact = await setMemoryFact({
      userId: resolveRequestUserId(body.userId),
      category: body.category as never,
      key: body.key,
      value: body.value as never,
      source: body.source as never,
    });

    return Response.json({ fact });
  } catch (error) {
    if (isClientMemoryError(error)) {
      return apiErrorResponse(new ApiRouteError(400, "invalid_memory_payload", getErrorMessage(error)), "[api/user-memory] POST failed");
    }
    return apiErrorResponse(error, "[api/user-memory] POST failed");
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      userId?: string;
      key?: string;
    };

    if (typeof body.key !== "string" || body.key.trim().length === 0) {
      throw new ApiRouteError(400, "invalid_memory_payload", "key is required.");
    }

    const forgotten = await forgetMemoryFact({
      userId: resolveRequestUserId(body.userId),
      key: body.key,
    });

    return Response.json({ forgotten });
  } catch (error) {
    if (isClientMemoryError(error)) {
      return apiErrorResponse(new ApiRouteError(400, "invalid_memory_payload", getErrorMessage(error)), "[api/user-memory] DELETE failed");
    }
    return apiErrorResponse(error, "[api/user-memory] DELETE failed");
  }
}