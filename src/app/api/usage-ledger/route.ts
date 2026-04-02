import { NextRequest } from "next/server";
import {
  deleteAgentRun,
  deleteUsageLedgerEntry,
  getUsageLedgerSnapshot,
  listUsageLedgerRuns,
} from "@/lib/agent/run-journal";

interface UsageLedgerDeleteRequest {
  runId?: string;
  entryId?: string;
}

export async function GET(request: NextRequest) {
  try {
    const entryId = request.nextUrl.searchParams.get("entryId")?.trim() || null;

    return Response.json({
      snapshot: getUsageLedgerSnapshot(),
      selectedEntryId: entryId,
      entryRuns: entryId ? listUsageLedgerRuns(entryId) : [],
    });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = (await request.json()) as UsageLedgerDeleteRequest;

    if (body.runId) {
      const deletedRun = deleteAgentRun(body.runId);
      return Response.json({
        deletedRunId: deletedRun.runId,
      });
    }

    if (body.entryId) {
      return Response.json(deleteUsageLedgerEntry(body.entryId));
    }

    return Response.json({ error: "runId or entryId is required." }, { status: 400 });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}