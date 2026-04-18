import { beforeEach, describe, expect, it, vi } from "vitest";

const memoryMocks = vi.hoisted(() => ({
  getOrCreateConversation: vi.fn(),
  saveMessage: vi.fn(),
}));

const userContextMocks = vi.hoisted(() => ({
  resolveAgentUserId: vi.fn(),
}));

const projectMocks = vi.hoisted(() => ({
  createBuilderProject: vi.fn(),
}));

const orchestratorMocks = vi.hoisted(() => ({
  planBuilderProject: vi.fn(),
}));

vi.mock("@/lib/agent/memory", () => ({
  getOrCreateConversation: memoryMocks.getOrCreateConversation,
  saveMessage: memoryMocks.saveMessage,
}));

vi.mock("@/lib/agent/user-context", () => ({
  resolveAgentUserId: userContextMocks.resolveAgentUserId,
}));

vi.mock("@/lib/builder/projects", () => ({
  createBuilderProject: projectMocks.createBuilderProject,
}));

vi.mock("@/lib/builder/orchestrator", () => ({
  planBuilderProject: orchestratorMocks.planBuilderProject,
}));

import { createProjectFromOnboarding } from "@/lib/builder/onboarding";

describe("builder onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userContextMocks.resolveAgentUserId.mockReturnValue("local-user");
    projectMocks.createBuilderProject.mockResolvedValue({
      id: "project-1",
      name: "Builder Clean Retest",
      relativePath: "projects/builder-clean-retest",
    });
    orchestratorMocks.planBuilderProject.mockResolvedValue({});
    memoryMocks.getOrCreateConversation.mockResolvedValue("conv-1");
    memoryMocks.saveMessage.mockResolvedValue(undefined);
  });

  it("creates an initial brief and plan during onboarding", async () => {
    await createProjectFromOnboarding({
      name: "Builder Clean Retest",
      description: "Fresh Builder smoke test after clearing old artifacts.",
      stackPresetKey: "next-prisma-tailwind",
      template: "next-app",
      packageManager: "NPM",
      docker: true,
      git: true,
    }, {
      conversationId: "conv-1",
    });

    expect(orchestratorMocks.planBuilderProject).toHaveBeenCalledWith("project-1", {
      title: "Builder Clean Retest",
      summary: "Fresh Builder smoke test after clearing old artifacts.",
      goals: ["Fresh Builder smoke test after clearing old artifacts."],
      constraints: [
        "Use the selected next-prisma-tailwind stack preset as the starting point.",
        "Docker should be included for this project.",
        "Git should be initialized for this project.",
      ],
      deliverables: [
        "A working Builder Clean Retest project scaffold ready for follow-up Builder tasks.",
      ],
    });

    expect(memoryMocks.saveMessage).toHaveBeenLastCalledWith(
      "conv-1",
      "ASSISTANT",
      expect.stringContaining("The initial Builder brief and plan are ready."),
      { chatMode: "agent", chatPluginId: "builder" },
    );
  });
});