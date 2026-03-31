import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userUpsert: vi.fn(),
  findMany: vi.fn(),
  upsert: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      upsert: mocks.userUpsert,
    },
    userMemoryFact: {
      findMany: mocks.findMany,
      upsert: mocks.upsert,
      updateMany: mocks.updateMany,
    },
  },
}));

import {
  forgetMemoryFact,
  formatMemoryFactsForPrompt,
  getActiveMemoryFacts,
  setMemoryFact,
} from "@/lib/agent/memory/service";

describe("explicit memory service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns only active facts for the current user with normalized filters", async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: "fact-1",
        userId: "user-1",
        category: "preference",
        key: "timezone",
        value: "America/Chicago",
        source: "user",
        isActive: true,
        createdAt: new Date("2026-03-31T12:00:00.000Z"),
        updatedAt: new Date("2026-03-31T12:05:00.000Z"),
      },
    ]);

    const facts = await getActiveMemoryFacts({
      userId: "user-1",
      categories: ["preference"],
      keys: [" Timezone "],
    });

    expect(mocks.findMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        isActive: true,
        category: { in: ["preference"] },
        key: { in: ["timezone"] },
      },
      orderBy: [{ category: "asc" }, { key: "asc" }, { createdAt: "asc" }],
    });
    expect(facts).toEqual([
      {
        id: "fact-1",
        userId: "user-1",
        category: "preference",
        key: "timezone",
        value: "America/Chicago",
        source: "user",
        isActive: true,
        createdAt: "2026-03-31T12:00:00.000Z",
        updatedAt: "2026-03-31T12:05:00.000Z",
      },
    ]);
  });

  it("upserts by user and key and reactivates inactive facts", async () => {
    mocks.upsert.mockResolvedValue({
      id: "fact-1",
      userId: "user-1",
      category: "workflow",
      key: "review_reply_workflow",
      value: { tone: "calm", length: "short" },
      source: "user",
      isActive: true,
      createdAt: new Date("2026-03-31T12:00:00.000Z"),
      updatedAt: new Date("2026-03-31T12:05:00.000Z"),
    });

    const fact = await setMemoryFact({
      userId: "user-1",
      category: "workflow",
      key: "Review Reply Workflow",
      value: { tone: "calm", length: "short" },
    });

    expect(mocks.userUpsert).toHaveBeenCalledWith({
      where: { id: "user-1" },
      create: { id: "user-1", name: "User" },
      update: {},
    });
    expect(mocks.upsert).toHaveBeenCalledWith({
      where: {
        userId_key: {
          userId: "user-1",
          key: "review_reply_workflow",
        },
      },
      create: {
        userId: "user-1",
        category: "workflow",
        key: "review_reply_workflow",
        value: { tone: "calm", length: "short" },
        source: "user",
        isActive: true,
      },
      update: {
        category: "workflow",
        value: { tone: "calm", length: "short" },
        source: "user",
        isActive: true,
      },
    });
    expect(fact.key).toBe("review_reply_workflow");
    expect(fact.isActive).toBe(true);
  });

  it("soft deletes a fact for the current user", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });

    const result = await forgetMemoryFact({ userId: "user-1", key: "Timezone" });

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        key: "timezone",
        isActive: true,
      },
      data: {
        isActive: false,
      },
    });
    expect(result).toEqual({ count: 1, key: "timezone" });
  });

  it("rejects unsafe or oversized explicit memory values", async () => {
    await expect(() => setMemoryFact({
      userId: "user-1",
      category: "constraint",
      key: "api_token",
      value: "secret",
    })).rejects.toThrow("Refusing to store secrets");

    await expect(() => setMemoryFact({
      userId: "user-1",
      category: "other",
      key: "large_blob",
      value: "x".repeat(3_000),
    })).rejects.toThrow("payload is too large");
  });

  it("formats a compact deterministic prompt block", () => {
    const block = formatMemoryFactsForPrompt([
      {
        id: "fact-1",
        userId: "user-1",
        category: "identity",
        key: "preferred_name",
        value: "Sam",
        source: "user",
        isActive: true,
        createdAt: "2026-03-31T12:00:00.000Z",
        updatedAt: "2026-03-31T12:05:00.000Z",
      },
    ]);

    expect(block).toBe([
      "[User Memory]",
      '- preferred_name: "Sam" (category: identity)',
      "[/User Memory]",
    ].join("\n"));
    expect(formatMemoryFactsForPrompt([])).toBe("");
  });
});