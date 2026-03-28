import type { BuilderCliProfile, BuilderProject } from "@prisma/client";
import { getBuilderCliProfile } from "@/lib/builder/cli-profiles";
import { getBuilderConfig } from "@/lib/builder/config";
import { runBuilderCliCommand } from "@/lib/builder/workspace";

export interface BuilderAgenticTaskInput {
  profile?: string;
  prompt: string;
  model?: string;
  args?: string[];
}

export interface BuilderAgenticTaskExecution {
  profile: BuilderCliProfile;
  command: string;
  args: string[];
}

function isProfileAvailable(profile: BuilderCliProfile): boolean {
  const metadata = (profile.metadata ?? {}) as Record<string, unknown>;
  return metadata.available === true;
}

function getAvailabilityReason(profile: BuilderCliProfile): string {
  const metadata = (profile.metadata ?? {}) as Record<string, unknown>;
  return typeof metadata.availabilityReason === "string"
    ? metadata.availabilityReason
    : `Builder CLI profile is unavailable: ${profile.displayName}`;
}

export async function buildBuilderAgenticExecution(
  project: BuilderProject,
  input: BuilderAgenticTaskInput,
): Promise<BuilderAgenticTaskExecution> {
  const config = getBuilderConfig();
  const profileKey = input.profile?.trim() || config.defaultAgenticProfile;
  const prompt = input.prompt.trim();
  if (!prompt) {
    throw new Error("Agentic builder prompt is required.");
  }

  const profile = await getBuilderCliProfile(profileKey);
  if (!profile.enabled) {
    throw new Error(`Builder CLI profile is disabled: ${profile.displayName}`);
  }
  if (!profile.supportsNonInteractive) {
    throw new Error(`Builder CLI profile does not support non-interactive execution: ${profile.displayName}`);
  }
  if (!isProfileAvailable(profile)) {
    throw new Error(getAvailabilityReason(profile));
  }

  switch (profile.key) {
    case "codex": {
      const args = [
        "exec",
        "--full-auto",
        "--sandbox",
        "workspace-write",
        "--skip-git-repo-check",
        "--color",
        "never",
        ...(input.model?.trim() ? ["--model", input.model.trim()] : []),
        ...(input.args ?? []),
        prompt,
      ];
      return {
        profile,
        command: profile.command,
        args,
      };
    }
    default:
      throw new Error(`Builder CLI profile is not wired for execution yet: ${profile.displayName}`);
  }
}

export async function executeBuilderAgenticTask(
  project: BuilderProject,
  input: BuilderAgenticTaskInput,
) {
  const execution = await buildBuilderAgenticExecution(project, input);
  const config = getBuilderConfig();
  const result = await runBuilderCliCommand(execution.command, execution.args, {
    cwd: project.relativePath,
    timeoutSeconds: config.agenticTimeoutSeconds,
  });

  return {
    profile: execution.profile,
    command: execution.command,
    args: execution.args,
    result,
  };
}