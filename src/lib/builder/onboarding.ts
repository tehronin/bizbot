import type { BuilderPackageManager } from "@prisma/client";
import { getOrCreateConversation, saveMessage } from "@/lib/agent/memory";
import { resolveAgentUserId } from "@/lib/agent/user-context";
import { planBuilderProject } from "@/lib/builder/orchestrator";
import { createBuilderProject } from "@/lib/builder/projects";
import { getBuilderStackPreset } from "@/lib/builder/stacks";
import type { BuilderOnboardingSpec } from "@/lib/chat/types";

export interface BuilderOnboardingResult {
  projectId: string;
  projectName: string;
  projectRelativePath: string;
  conversationId: string;
}

function resolvePackageManager(value: string): BuilderPackageManager {
  const upper = value.toUpperCase();
  return upper === "PNPM" ? "PNPM" : "NPM";
}

function buildInitialBrief(spec: BuilderOnboardingSpec): {
  title: string;
  summary: string;
  goals: string[];
  constraints: string[];
  deliverables: string[];
} {
  const name = spec.name.trim();
  const description = spec.description.trim();
  const summary = description || `Build ${name} and prepare it for the first implementation task.`;
  const stackLabel = spec.stackPresetKey ? `Use the selected ${spec.stackPresetKey} stack preset as the starting point.` : null;

  return {
    title: name,
    summary,
    goals: [summary],
    constraints: [
      ...(stackLabel ? [stackLabel] : []),
      `Docker ${spec.docker ? "should be included" : "is not required"} for this project.`,
      `Git ${spec.git ? "should be initialized" : "is not required"} for this project.`,
    ],
    deliverables: [
      `A working ${name} project scaffold ready for follow-up Builder tasks.`,
    ],
  };
}

export async function createProjectFromOnboarding(
  spec: BuilderOnboardingSpec,
  options?: { conversationId?: string | null; userId?: string },
): Promise<BuilderOnboardingResult> {
  const name = spec.name.trim();
  if (!name) {
    throw new Error("Project name is required.");
  }

  const userId = resolveAgentUserId(options?.userId);

  const stackPreset = spec.stackPresetKey ? getBuilderStackPreset(spec.stackPresetKey) : null;
  const template = stackPreset?.template ?? (spec.template || "node-cli");
  const packageManager = stackPreset?.packageManager ?? resolvePackageManager(spec.packageManager);

  const project = await createBuilderProject({
    name,
    stackPresetKey: stackPreset?.key,
    template,
    packageManager,
  });

  await planBuilderProject(project.id, buildInitialBrief(spec));

  const conversationId = await getOrCreateConversation(
    options?.conversationId ?? undefined,
    userId,
  );

  const descriptionLine = spec.description ? ` — ${spec.description}` : "";
  const stackLine = stackPreset ? stackPreset.displayName : `${template} / ${packageManager}`;

  await saveMessage(
    conversationId,
    "USER",
    `Create a new Builder project: **${name}**${descriptionLine}\nStack: ${stackLine}, Docker: ${spec.docker ? "yes" : "no"}, Git: ${spec.git ? "yes" : "no"}`,
    { chatMode: "agent", chatPluginId: "builder" },
  );

  await saveMessage(
    conversationId,
    "ASSISTANT",
    `Project **${project.name}** created at \`${project.relativePath}\`.\n\nConfiguration:\n- Template: ${template}\n- Package manager: ${packageManager}${stackPreset ? `\n- Stack preset: ${stackPreset.displayName}` : ""}\n- Docker: ${spec.docker ? "enabled" : "disabled"}\n- Git: ${spec.git ? "enabled" : "disabled"}\n\nThe initial Builder brief and plan are ready. Describe your first task to get started.`,
    { chatMode: "agent", chatPluginId: "builder" },
  );

  return {
    projectId: project.id,
    projectName: project.name,
    projectRelativePath: project.relativePath,
    conversationId,
  };
}
