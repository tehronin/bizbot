import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActiveMemoryFacts: vi.fn(),
  setMemoryFact: vi.fn(),
  forgetMemoryFact: vi.fn(),
}));

vi.mock("@/lib/agent/memory/service", () => ({
  getActiveMemoryFacts: mocks.getActiveMemoryFacts,
  setMemoryFact: mocks.setMemoryFact,
  forgetMemoryFact: mocks.forgetMemoryFact,
}));

import { DELETE, GET, POST } from "@/app/api/user-memory/route";

describe("user memory route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists facts with optional category and key filters", async () => {
    mocks.getActiveMemoryFacts.mockResolvedValue([{ key: "timezone" }]);

    const response = await GET(new NextRequest("http://localhost/api/user-memory?userId=user-1&category=preference&key=timezone"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.getActiveMemoryFacts).toHaveBeenCalledWith({
      userId: "user-1",
      categories: ["preference"],
      keys: ["timezone"],
    });
    expect(payload).toEqual({ userId: "user-1", facts: [{ key: "timezone" }] });
  });

  it("stores a fact through POST", async () => {
    mocks.setMemoryFact.mockResolvedValue({ key: "preferred_name", value: "Sam" });

    const response = await POST(new NextRequest("http://localhost/api/user-memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "user-1",
        category: "identity",
        key: "preferred_name",
        value: "Sam",
        source: "user",
      }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.setMemoryFact).toHaveBeenCalledWith({
      userId: "user-1",
      category: "identity",
      key: "preferred_name",
      value: "Sam",
      source: "user",
    });
    expect(payload).toEqual({ fact: { key: "preferred_name", value: "Sam" } });
  });

  it("forgets a fact through DELETE", async () => {
    mocks.forgetMemoryFact.mockResolvedValue({ count: 1, key: "timezone" });

    const response = await DELETE(new NextRequest("http://localhost/api/user-memory", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "timezone" }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.forgetMemoryFact).toHaveBeenCalledWith({ userId: "local-user", key: "timezone" });
    expect(payload).toEqual({ forgotten: { count: 1, key: "timezone" } });
  });
});