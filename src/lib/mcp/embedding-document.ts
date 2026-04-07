import type { BuilderMcpSnapshotRecordState } from "@/lib/builder/types";

export const MCP_EMBEDDING_FORMAT_VERSION = "v1";

function joinLines(values: string[], empty: string): string {
  return values.length > 0 ? values.join("; ") : empty;
}

export function buildMcpSnapshotEmbeddingDocument(snapshot: BuilderMcpSnapshotRecordState): string {
  const uniqueToolNames = Array.from(new Set(snapshot.mappings.map((mapping) => mapping.toolName))).sort();
  const validatorContext = Array.from(new Set(snapshot.mappings.flatMap((mapping) => mapping.validatorContext))).sort();
  const activeAdrDecisionKeys = Array.from(new Set(snapshot.mappings.flatMap((mapping) => mapping.activeAdrDecisionKeys))).sort();
  const ontologyHints = Array.from(new Set(snapshot.mappings.flatMap((mapping) => mapping.ontologyHints))).sort();
  const metadata = snapshot.metadata ?? {};
  const driftFrom = typeof metadata.previousHash === "string"
    ? metadata.previousHash
    : typeof metadata.driftFrom === "string"
      ? metadata.driftFrom
      : null;

  return [
    "[Builder MCP Snapshot]",
    `Project: ${snapshot.projectId}`,
    `Run: ${snapshot.runId}`,
    `Snapshot sequence: ${snapshot.snapshotSequence}`,
    `Snapshot hash: ${snapshot.versionHash}`,
    `Applied at: ${snapshot.appliedAt}`,
    driftFrom ? `Drift from: ${driftFrom}` : "Drift from: none",
    `Profile: ${snapshot.snapshot.profile.agentProfile} / ${snapshot.snapshot.profile.autonomyPreset}`,
    `Tool count: ${snapshot.snapshot.tools.length}`,
    `Prompt count: ${snapshot.snapshot.prompts.length}`,
    `Resource count: ${snapshot.snapshot.resources.length}`,
    `Mapped tool count: ${uniqueToolNames.length}`,
    `Mapped validator contexts: ${joinLines(validatorContext, "none")}`,
    `Mapped ADR keys: ${joinLines(activeAdrDecisionKeys, "none")}`,
    `Mapped ontology hints: ${joinLines(ontologyHints, "none")}`,
    `Visible tools: ${joinLines(snapshot.snapshot.tools.map((tool) => `${tool.name} (${tool.ownerKind})`), "none")}`,
    `Visible prompts: ${joinLines(snapshot.snapshot.prompts.map((prompt) => prompt.name), "none")}`,
    `Visible resources: ${joinLines(snapshot.snapshot.resources.map((resource) => resource.uri), "none")}`,
    `Observed tool mappings: ${joinLines(snapshot.mappings.map((mapping) => `${mapping.toolName} -> ${mapping.ownerId}`), "none")}`,
    "[/Builder MCP Snapshot]",
  ].join("\n");
}