import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const builderInteractionMocks = vi.hoisted(() => ({
  resolveBuilderInteraction: vi.fn(),
  launchBuilderTaskFromChat: vi.fn(),
}));

const builderOnboardingMocks = vi.hoisted(() => ({
  createProjectFromOnboarding: vi.fn(),
}));

vi.mock("@/lib/builder/interactions", () => ({
  resolveBuilderInteraction: builderInteractionMocks.resolveBuilderInteraction,
  launchBuilderTaskFromChat: builderInteractionMocks.launchBuilderTaskFromChat,
}));

vi.mock("@/lib/builder/onboarding", () => ({
  createProjectFromOnboarding: builderOnboardingMocks.createProjectFromOnboarding,
}));

vi.mock("@/lib/agent/user-context", () => ({
  resolveAgentUserId: (userId?: string | null) => userId ?? "local-user",
}));

import { POST as resolveInteraction } from "@/app/api/chat/builder/interactions/[id]/route";
import { POST as launchTask } from "@/app/api/chat/builder/tasks/route";
import { POST as createOnboarding } from "@/app/api/chat/builder/onboarding/route";

describe("chat Builder routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves Builder interaction cards from chat", async () => {
    builderInteractionMocks.resolveBuilderInteraction.mockResolvedValue({
      card: { id: "interaction-1", interactionId: "interaction-1", kind: "mcp_contract_drift", status: "approved" },
      summary: "Approved Builder contract rollover.",
      resolutionRunId: "run-42",
    });

    const response = await resolveInteraction(new NextRequest("http://localhost/api/chat/builder/interactions/interaction-1", {
      method: "POST",
      body: JSON.stringify({ action: "approve", conversationId: "conv-1" }),
    }), {
      params: Promise.resolve({ id: "interaction-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(builderInteractionMocks.resolveBuilderInteraction).toHaveBeenCalledWith({
      interactionId: "interaction-1",
      action: "approve",
      conversationId: "conv-1",
      reason: null,
    });
    expect(payload.summary).toBe("Approved Builder contract rollover.");
  });

  it("launches Builder tasks through the chat-owned route", async () => {
    builderInteractionMocks.launchBuilderTaskFromChat.mockResolvedValue({
      conversationId: "conv-2",
      execution: { status: "RUNNING", runId: "run-8", taskId: "task-8" },
      card: {
        id: "run-run-8",
        interactionId: "run-run-8",
        kind: "task_execution",
        status: "running",
        projectId: "project-1",
        projectName: "Alpha",
        projectRelativePath: "workspace/alpha",
        runId: "run-8",
        taskId: "task-8",
        title: "Implement Alpha step",
        summary: "Builder task started.",
        state: "implementing",
        recommendations: [],
        actions: [],
        updatedAt: "2026-04-16T17:00:00.000Z",
        resolvedAt: null,
        resolutionReason: null,
      },
    });

    const response = await launchTask(new NextRequest("http://localhost/api/chat/builder/tasks", {
      method: "POST",
      body: JSON.stringify({
        conversationId: "conv-2",
        projectId: "project-1",
        request: "Implement the archive card flow",
        retryFailed: true,
      }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(202);
    expect(builderInteractionMocks.launchBuilderTaskFromChat).toHaveBeenCalledWith({
      conversationId: "conv-2",
      projectId: "project-1",
      request: "Implement the archive card flow",
      retryFailed: true,
      taskId: null,
      profile: undefined,
      model: undefined,
      userId: "local-user",
    });
    expect(payload.execution.runId).toBe("run-8");
  });

  it("creates a project from onboarding spec", async () => {
    builderOnboardingMocks.createProjectFromOnboarding.mockResolvedValue({
      projectId: "project-new",
      projectName: "My App",
      projectRelativePath: "workspace/my-app",
      conversationId: "conv-3",
    });

    const response = await createOnboarding(new NextRequest("http://localhost/api/chat/builder/onboarding", {
      method: "POST",
      body: JSON.stringify({
        name: "My App",
        description: "A test project",
        stackPresetKey: "next-tailwind",
        template: "next-app",
        packageManager: "NPM",
        docker: true,
        git: true,
        conversationId: "conv-3",
      }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(builderOnboardingMocks.createProjectFromOnboarding).toHaveBeenCalledWith(
      {
        name: "My App",
        description: "A test project",
        stackPresetKey: "next-tailwind",
        template: "next-app",
        packageManager: "NPM",
        docker: true,
        git: true,
      },
      { conversationId: "conv-3" },
    );
    expect(payload.projectId).toBe("project-new");
  });

  it("rejects onboarding without a project name", async () => {
    const response = await createOnboarding(new NextRequest("http://localhost/api/chat/builder/onboarding", {
      method: "POST",
      body: JSON.stringify({ description: "Missing name" }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe("Project name is required.");
    expect(builderOnboardingMocks.createProjectFromOnboarding).not.toHaveBeenCalled();
  });
});
