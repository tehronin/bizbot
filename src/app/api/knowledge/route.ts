import { NextRequest } from "next/server";
import {
  deleteKnowledgeWorkspaceFile,
  getKnowledgeDashboard,
  getKnowledgeFilePreview,
  reindexAllKnowledgeFiles,
  reindexKnowledgeFile,
  uploadKnowledgeFiles,
} from "@/lib/agent/knowledge-management";

type KnowledgeAction = "reindex_all" | "reindex_file" | "delete_file";

function parseActionBody(value: unknown): { action: KnowledgeAction; path?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid knowledge action payload.");
  }

  const candidate = value as { action?: KnowledgeAction; path?: string };
  if (!candidate.action) {
    throw new Error("Knowledge action is required.");
  }

  if ((candidate.action === "reindex_file" || candidate.action === "delete_file") && (!candidate.path || typeof candidate.path !== "string")) {
    throw new Error("Knowledge file path is required for this action.");
  }

  return {
    action: candidate.action,
    ...(candidate.path ? { path: candidate.path } : {}),
  };
}

export async function GET(req: NextRequest) {
  try {
    const filePath = req.nextUrl.searchParams.get("path")?.trim();
    if (filePath) {
      const preview = await getKnowledgeFilePreview(filePath);
      return Response.json({ preview });
    }

    const dashboard = await getKnowledgeDashboard();
    return Response.json(dashboard);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File);

    if (files.length === 0) {
      return Response.json({ error: "At least one file is required." }, { status: 400 });
    }

    const result = await uploadKnowledgeFiles(files);
    const dashboard = await getKnowledgeDashboard();
    return Response.json({ uploaded: result, dashboard }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = parseActionBody(await req.json());

    const sync = body.action === "reindex_all"
      ? await reindexAllKnowledgeFiles()
      : body.action === "reindex_file"
        ? await reindexKnowledgeFile(body.path ?? "")
        : await deleteKnowledgeWorkspaceFile(body.path ?? "");

    const dashboard = await getKnowledgeDashboard();
    return Response.json({ action: body.action, path: body.path ?? null, sync, dashboard });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}