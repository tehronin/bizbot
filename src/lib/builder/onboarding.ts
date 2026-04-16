import type { BuilderPackageManager } from "@prisma/client";
import { getOrCreateConversation, saveMessage } from "@/lib/agent/memory";
import { resolveAgentUserId } from "@/lib/agent/user-context";
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
    `Project **${project.name}** created at \`${project.relativePath}\`.\n\nConfiguration:\n- Template: ${template}\n- Package manager: ${packageManager}${stackPreset ? `\n- Stack preset: ${stackPreset.displayName}` : ""}\n- Docker: ${spec.docker ? "enabled" : "disabled"}\n- Git: ${spec.git ? "enabled" : "disabled"}\n\nReady for building — describe your first task to get started.`,
    { chatMode: "agent", chatPluginId: "builder" },
  );

  return {
    projectId: project.id,
    projectName: project.name,
    projectRelativePath: project.relativePath,
    conversationId,
  };
}
