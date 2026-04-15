import path from "path";
import type { BuilderProject } from "@prisma/client";
import {
  execBuilderRuntimeContainerCommand,
  getBuilderRuntimeContainer,
  getBuilderRuntimeContainerLogs,
  readBuilderRuntimeContainerFile,
  startBuilderRuntimeService,
  statBuilderRuntimeContainerPath,
  teardownBuilderRuntimeService,
} from "@/lib/builder/runtime-orchestration";
import { getBuilderTemplateContainerStageContract } from "@/lib/builder/template-presets";
import type { BuilderReviewContainerStageFileState, BuilderReviewContainerStageScriptState, BuilderReviewContainerStageState } from "@/lib/builder/types";

const CONTAINER_PREVIEW_MAX_BYTES = 512;
const CONTAINER_LOG_TAIL_BYTES = 4000;

function toContainerScriptCommand(packageManager: BuilderProject["packageManager"], script: string): { command: string; args: string[]; display: string } {
  const command = packageManager === "PNPM" ? "pnpm" : "npm";
  const args = script === "test"
    ? ["test"]
    : ["run", script];
  return {
    command,
    args,
    display: `${command} ${args.join(" ")}`,
  };
}

function toContainerPath(workingDirectory: string, relativePath: string): string {
  return path.posix.join(workingDirectory, relativePath.replace(/\\/g, "/"));
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function buildSkippedState(summary: string): BuilderReviewContainerStageState {
  return {
    available: false,
    status: "skipped",
    summary,
    composeFile: null,
    serviceId: null,
    serviceName: null,
    workingDirectory: null,
    containerId: null,
    startedService: false,
    stoppedService: false,
    fileChecks: [],
    scriptChecks: [],
    logsPreview: null,
    auditPaths: [],
  };
}

export async function validateBuilderContainerStage(args: {
  project: Pick<BuilderProject, "id" | "template" | "relativePath" | "packageManager">;
  stopAfterValidation?: boolean;
}): Promise<BuilderReviewContainerStageState> {
  const contract = getBuilderTemplateContainerStageContract(args.project.template);
  if (!contract) {
    return buildSkippedState(`Template ${args.project.template} does not declare a Docker-ready container stage.`);
  }

  const serviceId = `compose:${contract.composeFile}:${contract.serviceName}`;
  const baseArgs = {
    projectId: args.project.id,
    projectRelativePath: args.project.relativePath,
    packageManager: args.project.packageManager,
    serviceId,
  };

  const auditPaths: string[] = [];
  const fileChecks: BuilderReviewContainerStageFileState[] = [];
  const scriptChecks: BuilderReviewContainerStageScriptState[] = [];
  let logsPreview: string | null = null;
  let startedService = false;
  let stoppedService = false;
  let wasRunning = false;
  let containerId: string | null = null;
  let outcome: BuilderReviewContainerStageState | null = null;

  try {
    const before = getBuilderRuntimeContainer(baseArgs);
    auditPaths.push(before.auditPath);
    wasRunning = before.container.status === "running";
    containerId = before.container.containerId;

    if (!wasRunning) {
      const startResult = await startBuilderRuntimeService(baseArgs);
      if (startResult.auditPath) {
        auditPaths.push(startResult.auditPath);
      }
      startedService = startResult.status === "completed";
      if (startResult.status !== "completed") {
        outcome = {
          available: true,
          status: "blocked",
          summary: startResult.message,
          composeFile: contract.composeFile,
          serviceId,
          serviceName: contract.serviceName,
          workingDirectory: contract.workingDirectory,
          containerId: startResult.service.containerId,
          startedService,
          stoppedService: false,
          fileChecks,
          scriptChecks,
          logsPreview: null,
          auditPaths: unique(auditPaths),
        };
        return outcome;
      }
    }

    const inspection = getBuilderRuntimeContainer(baseArgs);
    auditPaths.push(inspection.auditPath);
    containerId = inspection.container.containerId;

    for (const relativeFile of contract.requiredFiles) {
      const containerPath = toContainerPath(contract.workingDirectory, relativeFile);
      const stat = await statBuilderRuntimeContainerPath({
        ...baseArgs,
        path: containerPath,
      });
      auditPaths.push(stat.auditPath);

      let preview: string | null = null;
      let truncated = false;
      if (stat.exists && stat.type === "file" && contract.previewFiles.includes(relativeFile)) {
        const readResult = await readBuilderRuntimeContainerFile({
          ...baseArgs,
          path: containerPath,
          maxBytes: CONTAINER_PREVIEW_MAX_BYTES,
        });
        auditPaths.push(readResult.auditPath);
        preview = readResult.content;
        truncated = readResult.truncated;
      }

      fileChecks.push({
        path: containerPath,
        exists: stat.exists,
        type: stat.type,
        size: stat.size,
        preview,
        truncated,
        auditPath: stat.auditPath,
      });
    }

    for (const script of contract.verificationScripts) {
      const command = toContainerScriptCommand(args.project.packageManager, script);
      const result = await execBuilderRuntimeContainerCommand({
        ...baseArgs,
        command: command.command,
        commandArgs: command.args,
      });
      if (result.auditPath) {
        auditPaths.push(result.auditPath);
      }
      scriptChecks.push({
        script,
        command: command.display,
        exitCode: result.commandResult?.exitCode ?? null,
        passed: result.status === "completed",
        summary: result.message,
        auditPath: result.auditPath ?? null,
      });
    }

    try {
      const logs = await getBuilderRuntimeContainerLogs({
        ...baseArgs,
        tailBytes: CONTAINER_LOG_TAIL_BYTES,
      });
      auditPaths.push(logs.auditPath);
      logsPreview = logs.logs;
    } catch {
      logsPreview = null;
    }

    const missingFiles = fileChecks.filter((entry) => !entry.exists);
    const failedScripts = scriptChecks.filter((entry) => !entry.passed);
    const passed = missingFiles.length === 0 && failedScripts.length === 0;

    outcome = {
      available: true,
      status: passed ? "passed" : "failed",
      summary: passed
        ? `Container stage passed for ${contract.serviceName}.`
        : `Container stage failed with ${missingFiles.length} missing file check${missingFiles.length === 1 ? "" : "s"} and ${failedScripts.length} failed script${failedScripts.length === 1 ? "" : "s"}.`,
      composeFile: contract.composeFile,
      serviceId,
      serviceName: contract.serviceName,
      workingDirectory: contract.workingDirectory,
      containerId,
      startedService,
      stoppedService,
      fileChecks,
      scriptChecks,
      logsPreview,
      auditPaths: unique(auditPaths),
    };
    return outcome;
  } catch (error) {
    outcome = {
      available: true,
      status: "blocked",
      summary: error instanceof Error ? error.message : String(error),
      composeFile: contract.composeFile,
      serviceId,
      serviceName: contract.serviceName,
      workingDirectory: contract.workingDirectory,
      containerId,
      startedService,
      stoppedService,
      fileChecks,
      scriptChecks,
      logsPreview,
      auditPaths: unique(auditPaths),
    };
    return outcome;
  } finally {
    if ((args.stopAfterValidation ?? true) && !wasRunning) {
      try {
        const stopResult = await teardownBuilderRuntimeService(baseArgs);
        if (stopResult.auditPath) {
          auditPaths.push(stopResult.auditPath);
        }
        stoppedService = stopResult.status === "completed";
      } catch {
        stoppedService = false;
      }
    }

    if (outcome) {
      outcome.stoppedService = stoppedService;
      outcome.auditPaths = unique(auditPaths);
    }
  }
}