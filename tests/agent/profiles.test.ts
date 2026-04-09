import { describe, expect, it } from "vitest";

import { routeAgentProfile } from "@/lib/agent/profiles";

describe("agent profile routing", () => {
  it("routes builder workspace status prompts to the builder operator", () => {
    expect(routeAgentProfile("Summarize the current Builder workspace status in one short paragraph.")).toEqual({
      profile: "builder_operator",
      reason: "message appears to be about scaffolding, code generation, or building inside an external workspace",
    });
  });

  it("keeps browsing-style prompts on the research operator", () => {
    expect(routeAgentProfile("Research the latest competitor website updates.")).toEqual({
      profile: "research_operator",
      reason: "message appears to be about browsing, competitor tracking, or market research",
    });
  });
});