import { getBuilderConfig } from "@/lib/builder/config";
import { recordBuilderProjectCommand } from "@/lib/builder/commands";
import { completeBuilderRun, createBuilderRun, getBuilderProject, updateBuilderProject } from "@/lib/builder/projects";
import { listBuilderProjectArchitecture } from "@/lib/builder/planning";
import { syncBuilderTemplatePresets } from "@/lib/builder/template-presets";
import { bootstrapBuilderProject } from "@/lib/builder/template-bootstrap";
import { normalizeBuilderProjectContext } from "@/lib/builder/types";
import { listBuilderScaffoldBlockingEntries } from "@/lib/builder/workspace";
import { promoteBuilderArchitecturalDecisionsToOntology } from "@/lib/ontology/promotion";

export interface BuilderBootstrapOptions {
  initializeGit?: boolean;
  installDependencies?: boolean;
}

export async function runBuilderProjectBootstrap(projectId: string, options?: BuilderBootstrapOptions) {
  await syncBuilderTemplatePresets();
  const defaults = getBuilderConfig();
  const project = await getBuilderProject(projectId);

  if (listBuilderScaffoldBlockingEntries(project.relativePath).length > 0) {
    throw new Error("Builder project bootstrap requires an empty project directory.");
  }

  const run = await createBuilderRun({
    projectId: project.id,
    kind: "BOOTSTRAP",
    title: `Bootstrap ${project.template}`,
    command: project.template,
  });

  const bootstrap = await bootstrapBuilderProject(project);
  if (bootstrap.dependencyContract) {
    await promoteBuilderArchitecturalDecisionsToOntology({
      projectId: project.id,
      sourceRef: `builder:${project.id}:bootstrap:dependency_contract`,
      decisionKeys: bootstrap.dependencyContract.decisionKeys,
    });
  }
  if (bootstrap.fileTopologyContract) {
    await promoteBuilderArchitecturalDecisionsToOntology({
      projectId: project.id,
      sourceRef: `builder:${project.id}:bootstrap:file_topology_contract`,
      decisionKeys: bootstrap.fileTopologyContract.decisionKeys,
    });
  }
  await promoteBuilderArchitecturalDecisionsToOntology({
    projectId: project.id,
    sourceRef: `builder:${project.id}:bootstrap:mcp_policy`,
    decisionKeys: bootstrap.mcpPolicy.baseline.decisionKeys,
  });
  const architecture = await listBuilderProjectArchitecture(project.id);
  const currentContext = normalizeBuilderProjectContext(project.context);
  await updateBuilderProject(project.id, {
    context: {
      ...currentContext,
      dependencyContract: bootstrap.dependencyContract,
      fileTopologyContract: bootstrap.fileTopologyContract,
      mcpPolicy: bootstrap.mcpPolicy.baseline,
      architecture,
    } as never,
  });
  await completeBuilderRun(run.id, {
    status: "SUCCEEDED",
    summary: `Bootstrap completed for ${project.name}.`,
    metadata: bootstrap,
  });

  const resolvedOptions = {
    initializeGit: options?.initializeGit ?? defaults.initializeGitByDefault,
    installDependencies: options?.installDependencies ?? defaults.installDependenciesByDefault,
  };

  const postActions: Array<Awaited<ReturnType<typeof recordBuilderProjectCommand>>> = [];
  if (resolvedOptions.initializeGit) {
    postActions.push(await recordBuilderProjectCommand(project, { action: "initialize_git" }));
    await updateBuilderProject(project.id, { gitInitialized: true });
  }
  if (resolvedOptions.installDependencies) {
    postActions.push(await recordBuilderProjectCommand(project, { action: "install_dependencies" }));
  }

  return {
    project: await getBuilderProject(project.id),
    bootstrap,
    runId: run.id,
    postActions: postActions.map((action) => ({ runId: action.runId, title: action.title, ok: action.result.ok })),
  };
}