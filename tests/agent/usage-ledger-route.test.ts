import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runJournalMocks = vi.hoisted(() => ({
  getUsageLedgerSnapshot: vi.fn(),
  listUsageLedgerRuns: vi.fn(),
  deleteAgentRun: vi.fn(),
  deleteUsageLedgerEntry: vi.fn(),
}));

vi.mock("@/lib/agent/run-journal", () => ({
  getUsageLedgerSnapshot: runJournalMocks.getUsageLedgerSnapshot,
  listUsageLedgerRuns: runJournalMocks.listUsageLedgerRuns,
  deleteAgentRun: runJournalMocks.deleteAgentRun,
  deleteUsageLedgerEntry: runJournalMocks.deleteUsageLedgerEntry,
}));

import { DELETE, GET } from "@/app/api/usage-ledger/route";

describe("usage ledger route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runJournalMocks.getUsageLedgerSnapshot.mockReturnValue({
      totals: {
        entryCount: 1,
        runCount: 2,
        promptTokens: 20,
        completionTokens: 10,
        totalTokens: 30,
        cachedPromptTokens: 0,
      },
      entries: [{ id: "day=2026-04-01&provider=google&model=gemini", provider: "google" }],
    });
    runJournalMocks.listUsageLedgerRuns.mockReturnValue([{ runId: "run-1" }]);
    runJournalMocks.deleteAgentRun.mockReturnValue({ runId: "run-1" });
    runJournalMocks.deleteUsageLedgerEntry.mockReturnValue({ entryId: "entry-1", deletedRunIds: ["run-1"], deletedCount: 1 });
  });

  it("returns the usage ledger snapshot and optional entry runs", async () => {
    const response = await GET(new NextRequest("http://localhost/api/usage-ledger?entryId=entry-1"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(runJournalMocks.getUsageLedgerSnapshot).toHaveBeenCalledTimes(1);
    expect(runJournalMocks.listUsageLedgerRuns).toHaveBeenCalledWith("entry-1");
    expect(payload.selectedEntryId).toBe("entry-1");
    expect(payload.entryRuns).toEqual([{ runId: "run-1" }]);
  });

  it("deletes a single run or an entire ledger entry", async () => {
    const runResponse = await DELETE(new NextRequest("http://localhost/api/usage-ledger", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: "run-1" }),
    }));
    const entryResponse = await DELETE(new NextRequest("http://localhost/api/usage-ledger", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryId: "entry-1" }),
    }));

    expect(runResponse.status).toBe(200);
    expect(entryResponse.status).toBe(200);
    expect(runJournalMocks.deleteAgentRun).toHaveBeenCalledWith("run-1");
    expect(runJournalMocks.deleteUsageLedgerEntry).toHaveBeenCalledWith("entry-1");
  });

  it("rejects delete requests with no target", async () => {
    const response = await DELETE(new NextRequest("http://localhost/api/usage-ledger", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain("runId or entryId is required");
  });
});