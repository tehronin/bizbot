import { BUILDER_CAPABILITY_CATALOG } from "@/lib/builder/capabilities";
import type { BuilderPlanAdherenceState, BuilderTaskSpecState } from "@/lib/builder/types";

export const BUILDER_ALWAYS_ON_CORE = [
  "builder_get_project",
  "builder_get_status",
  "builder_list_files",
  "builder_read_file",
  "builder_write_file",
  "builder_append_file",
  "builder_apply_patch",
  "builder_create_directory",
  "builder_ensure_directory",
  "builder_stat_path",
  "builder_path_exists",
  "builder_move_path",
  "builder_delete_path",
  "builder_diff",
] as const;

const BUILDER_TOOL_FAMILY_CAPABILITIES = {
  container: ["container_inspection", "container_execution", "runtime_orchestration"],
  git: ["version_control"],
  gitRemote: ["version_control_remote"],
  deps: ["process_execution"],
  env: ["environment_configuration"],
  http: ["network_http"],
  db: ["database_introspection"],
  process: ["process_execution"],
} as const;

export type BuilderToolFamily = keyof typeof BUILDER_TOOL_FAMILY_CAPABILITIES;

const BUILDER_TOOL_FAMILY_EXTRA_TOOLS: Partial<Record<BuilderToolFamily, readonly string[]>> = {
  deps: ["builder_bootstrap_project", "builder_scaffold_node_package"],
};

export interface BuilderToolSubsetSelection {
  allowedToolNames: string[];
  familyLabels: string[];
}

const FAMILY_PATTERNS: Array<{ family: BuilderToolFamily; pattern: RegExp }> = [
  { family: "container", pattern: /\b(docker|compose|container|service|image|stage|runtime)\b/i },
  { family: "git", pattern: /\b(git|commit|branch|merge|rebase|tag|diff|stash|checkout|stage|unstage)\b/i },
  { family: "gitRemote", pattern: /\b(remote|fetch|pull|push|clone)\b/i },
  { family: "env", pattern: /\b(env|dotenv|\.env|config|secret)\b/i },
  { family: "deps", pattern: /\b(dependenc(?:y|ies)|package\.json|install|npm|pnpm|yarn|bootstrap|scaffold)\b/i },
  { family: "http", pattern: /\b(http|https|api|endpoint|request|fetch|webhook|curl)\b/i },
  { family: "db", pattern: /\b(prisma|schema|migration|database|\bdb\b|sql)\b/i },
  { family: "process", pattern: /\b(process|worker|daemon|background|spawn|log|logs|stream)\b/i },
];

function collectCapabilityTools(capabilityKeys: readonly string[]): string[] {
  const tools = new Set<string>();
  for (const capabilityKey of capabilityKeys) {
    const capability = BUILDER_CAPABILITY_CATALOG.find((entry) => entry.key === capabilityKey);
    for (const toolName of capability?.tools ?? []) {
      tools.add(toolName);
    }
  }
  return Array.from(tools);
}

function addMatchingFamilies(target: Set<BuilderToolFamily>, haystack: string): void {
  for (const { family, pattern } of FAMILY_PATTERNS) {
    if (pattern.test(haystack)) {
      target.add(family);
    }
  }
}

function buildCoreSubset(profileAllowed: readonly string[]): BuilderToolSubsetSelection {
  const allowed = new Set<string>(BUILDER_ALWAYS_ON_CORE);
  for (const toolName of profileAllowed) {
    if (toolName.startsWith("memory_") || toolName.startsWith("sidecar_")) {
      allowed.add(toolName);
    }
  }

  return {
    allowedToolNames: profileAllowed.filter((toolName) => allowed.has(toolName)),
    familyLabels: ["core"],
  };
}

export function selectRelevantBuilderToolSubset(args: {
  taskSpec: Pick<BuilderTaskSpecState, "title" | "summary" | "validators" | "architecturalDecisionKeys">;
  adherenceMode: BuilderPlanAdherenceState["mode"];
  request: string;
  profileAllowed: string[];
}): BuilderToolSubsetSelection | undefined {
  if (args.adherenceMode === "analysis_only") {
    return buildCoreSubset(args.profileAllowed);
  }

  const families = new Set<BuilderToolFamily>();
  const taskSignals = [
    args.request,
    args.taskSpec.title,
    args.taskSpec.summary,
    ...args.taskSpec.architecturalDecisionKeys,
    ...args.taskSpec.validators.map((validator) => String(validator)),
  ].join("\n");

  addMatchingFamilies(families, taskSignals);

  if (args.adherenceMode === "scaffold") {
    families.add("deps");
    families.add("env");
  }

  if (families.size === 0) {
    return undefined;
  }

  const allowed = new Set<string>(BUILDER_ALWAYS_ON_CORE);
  for (const family of families) {
    const capabilityKeys = BUILDER_TOOL_FAMILY_CAPABILITIES[family];
    for (const toolName of collectCapabilityTools(capabilityKeys)) {
      allowed.add(toolName);
    }
    for (const toolName of BUILDER_TOOL_FAMILY_EXTRA_TOOLS[family] ?? []) {
      allowed.add(toolName);
    }
  }

  for (const toolName of args.profileAllowed) {
    if (toolName.startsWith("memory_") || toolName.startsWith("sidecar_")) {
      allowed.add(toolName);
    }
  }

  const allowedToolNames = args.profileAllowed.filter((toolName) => allowed.has(toolName));
  if (allowedToolNames.length === 0) {
    return undefined;
  }

  return {
    allowedToolNames,
    familyLabels: Array.from(families).sort((left, right) => left.localeCompare(right)),
  };
}