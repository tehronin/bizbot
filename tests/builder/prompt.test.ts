import { describe, expect, it } from "vitest";
import { composeBuilderTaskPrompt } from "@/lib/builder/prompt";

describe("builder prompt synthesis", () => {
  it("builds a compact task prompt from project state and selected fragments", () => {
    const prompt = composeBuilderTaskPrompt({
      project: {
        name: "Demo",
        relativePath: "projects/demo",
        template: "next-app",
        packageManager: "PNPM",
      } as never,
      task: {
        title: "Add a health endpoint",
        acceptanceCriteria: ["Add the endpoint", "Run tests"],
        metadata: { planSteps: [{ id: "1", label: "Implement endpoint", status: "in_progress" }] },
      } as never,
      context: {
        objective: "Ship the demo app.",
        architectureNotes: [],
        codingConventions: ["Use App Router."],
        constraints: ["Stay inside the external workspace."],
        importantCommands: ["pnpm test"],
        currentPlan: [],
        latestSessionSummary: "Previous test failed.",
        knownFailures: ["pnpm test currently fails."],
        nextSteps: ["Fix the test."],
        instructionNotes: null,
        updatedAt: null,
      },
      request: "Add a health endpoint and rerun the tests.",
      stage: "IMPLEMENTING",
      fragments: [{ source: "AGENTS.md", heading: "Mission", content: "Keep edits small and reviewable." }],
    });

    expect(prompt).toContain("Builder mission");
    expect(prompt).toContain("Add a health endpoint");
    expect(prompt).toContain("Keep edits small and reviewable.");
    expect(prompt).not.toContain("undefined");
  });
});