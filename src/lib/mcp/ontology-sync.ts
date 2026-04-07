import { db } from "@/lib/db";
import type { BuilderMcpSnapshotRecordState } from "@/lib/builder/types";

export const MCP_ONTOLOGY_SYNC_VERSION = "v1";

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function mergeMetadata(
  current: Record<string, unknown> | null,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(current ?? {}),
    ...patch,
  };
}

export async function syncBuilderMcpSnapshotOntology(snapshot: BuilderMcpSnapshotRecordState): Promise<{
  mappingCount: number;
  uniqueToolCount: number;
  validatorCount: number;
  activeAdrDecisionKeys: string[];
  ontologyHints: string[];
}> {
  const uniqueToolNames = Array.from(new Set(snapshot.mappings.map((mapping) => mapping.toolName))).sort();
  const validatorContext = Array.from(new Set(snapshot.mappings.flatMap((mapping) => mapping.validatorContext))).sort();
  const activeAdrDecisionKeys = Array.from(new Set(snapshot.mappings.flatMap((mapping) => mapping.activeAdrDecisionKeys))).sort();
  const ontologyHints = Array.from(new Set(snapshot.mappings.flatMap((mapping) => mapping.ontologyHints))).sort();
  const currentMetadata = readObject(snapshot.metadata) ?? {};
  const enrichment = readObject(currentMetadata.enrichment) ?? {};
  const semantic = readObject(enrichment.semantic) ?? {};
  const queue = readObject(enrichment.queue) ?? {};
  const nextMetadata = mergeMetadata(currentMetadata, {
    enrichment: {
      ...enrichment,
      semantic: {
        ...semantic,
        mappingCount: snapshot.mappings.length,
        uniqueToolCount: uniqueToolNames.length,
        validatorCount: validatorContext.length,
        activeAdrDecisionKeys,
        ontologyHints,
        ontologySyncVersion: MCP_ONTOLOGY_SYNC_VERSION,
        ontologySyncedAt: new Date().toISOString(),
      },
      queue: {
        ...queue,
        ontology: {
          ...(readObject(queue.ontology) ?? {}),
          status: "completed",
          syncVersion: MCP_ONTOLOGY_SYNC_VERSION,
          finishedAt: new Date().toISOString(),
        },
      },
    },
  });

  await db.builderMcpSnapshot.update({
    where: { id: snapshot.id },
    data: {
      metadata: nextMetadata as never,
    },
  });

  return {
    mappingCount: snapshot.mappings.length,
    uniqueToolCount: uniqueToolNames.length,
    validatorCount: validatorContext.length,
    activeAdrDecisionKeys,
    ontologyHints,
  };
}