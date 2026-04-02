import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const tempWorkspaceRoot = vi.hoisted(() => `${process.cwd().replace(/\\/g, "/")}/.tmp-vitest-run-journal`);

vi.mock("@/lib/files/workspace", () => ({
  getWorkspacePath: () => tempWorkspaceRoot,
}));

import {
  deleteAgentRun,
  deleteUsageLedgerEntry,
  getUsageLedgerSnapshot,
  listAgentRuns,
  listUsageLedgerRuns,
  startAgentRun,
  completeAgentRun,
  recordAgentRunRoundUsage,
} from "@/lib/agent/run-journal";

function resetRunsDir(): void {
  fs.rmSync(path.join(tempWorkspaceRoot, ".bizbot"), { recursive: true, force: true });
}

describe("run journal usage ledger", () => {
  beforeEach(() => {
    resetRunsDir();
  });

  afterAll(() => {
    fs.rmSync(tempWorkspaceRoot, { recursive: true, force: true });
  });

  it("aggregates runs by day, provider, and model", () => {
    const runA = startAgentRun({
      conversationId: "conversation-1",
      profile: "general_operator",
      provider: "google",
      model: "gemini-3-flash-preview",
      userMessage: "first",
      availableTools: [],
    });
    const runB = startAgentRun({
      conversationId: "conversation-2",
      profile: "content_operator",
      provider: "google",
      model: "gemini-3-flash-preview",
      userMessage: "second",
      availableTools: [],
    });
    const runC = startAgentRun({
      conversationId: "conversation-3",
      profile: "builder_operator",
      provider: "ollama",
      model: "gemma3",
      userMessage: "third",
      availableTools: [],
    });

    recordAgentRunRoundUsage(runA.runId, {
      round: 1,
      provider: "google",
      model: "gemini-3-flash-preview",
      promptTokens: 100,
      completionTokens: 25,
      totalTokens: 125,
      cachedPromptTokens: 5,
    });
    recordAgentRunRoundUsage(runB.runId, {
      round: 1,
      provider: "google",
      model: "gemini-3-flash-preview",
      promptTokens: 120,
      completionTokens: 20,
      totalTokens: 140,
      cachedPromptTokens: 0,
    });
    recordAgentRunRoundUsage(runB.runId, {
      round: 2,
      provider: "google",
      model: "gemini-3-flash-preview",
      promptTokens: 60,
      completionTokens: 10,
      totalTokens: 70,
      cachedPromptTokens: 2,
    });
    recordAgentRunRoundUsage(runC.runId, {
      round: 1,
      provider: "ollama",
      model: "gemma3",
      promptTokens: 40,
      completionTokens: 10,
      totalTokens: 50,
      cachedPromptTokens: 0,
    });

    completeAgentRun(runA.runId, { status: "completed", roundsCompleted: 1, reply: "ok" });
    completeAgentRun(runB.runId, { status: "failed", roundsCompleted: 1, error: "boom" });
    completeAgentRun(runC.runId, { status: "completed", roundsCompleted: 1, reply: "done" });

    const snapshot = getUsageLedgerSnapshot();

    expect(snapshot.totals.entryCount).toBe(2);
    expect(snapshot.totals.runCount).toBe(3);
    expect(snapshot.totals.requestCount).toBe(4);
    expect(snapshot.totals.totalTokens).toBe(385);
    expect(snapshot.totals.averageTokensPerRequest).toBe(96.25);

    const googleEntry = snapshot.entries.find((entry) => entry.provider === "google");
    expect(googleEntry).toBeDefined();
    expect(googleEntry?.runCount).toBe(2);
    expect(googleEntry?.requestCount).toBe(3);
    expect(googleEntry?.promptTokens).toBe(280);
    expect(googleEntry?.completionTokens).toBe(55);
    expect(googleEntry?.totalTokens).toBe(335);
    expect(googleEntry?.cachedPromptTokens).toBe(7);
    expect(googleEntry?.averageTokensPerRun).toBe(167.5);
    expect(googleEntry?.averageTokensPerRequest).toBeCloseTo(111.666, 2);
    expect(googleEntry?.statusCounts.completed).toBe(1);
    expect(googleEntry?.statusCounts.failed).toBe(1);

    const googleRuns = listUsageLedgerRuns(googleEntry!.id);
    expect(googleRuns).toHaveLength(2);
    expect(googleRuns[0]?.provider).toBe("google");
    expect(googleRuns[0]?.requestCount).toBeGreaterThanOrEqual(1);
  });

  it("deletes a single run or an entire ledger entry", () => {
    const runA = startAgentRun({
      conversationId: "conversation-1",
      profile: "general_operator",
      provider: "google",
      model: "gemini-3-flash-preview",
      userMessage: "first",
      availableTools: [],
    });
    const runB = startAgentRun({
      conversationId: "conversation-2",
      profile: "general_operator",
      provider: "google",
      model: "gemini-3-flash-preview",
      userMessage: "second",
      availableTools: [],
    });

    recordAgentRunRoundUsage(runA.runId, {
      round: 1,
      provider: "google",
      model: "gemini-3-flash-preview",
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      cachedPromptTokens: 0,
    });
    recordAgentRunRoundUsage(runB.runId, {
      round: 1,
      provider: "google",
      model: "gemini-3-flash-preview",
      promptTokens: 11,
      completionTokens: 6,
      totalTokens: 17,
      cachedPromptTokens: 0,
    });

    completeAgentRun(runA.runId, { status: "completed", roundsCompleted: 1, reply: "ok" });
    completeAgentRun(runB.runId, { status: "completed", roundsCompleted: 1, reply: "ok" });

    deleteAgentRun(runA.runId);
    expect(listAgentRuns()).toHaveLength(1);

    const snapshot = getUsageLedgerSnapshot();
    const entry = snapshot.entries[0];
    expect(entry?.runCount).toBe(1);

    const deleted = deleteUsageLedgerEntry(entry!.id);
    expect(deleted.deletedCount).toBe(1);
    expect(listAgentRuns()).toHaveLength(0);
    expect(getUsageLedgerSnapshot().entries).toHaveLength(0);
  });
});