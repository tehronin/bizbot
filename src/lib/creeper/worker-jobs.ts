import { CompanyChunkKind, CompanyIngestionRunStatus, Prisma, SourceScanStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { embedBatch, formatEmbedding, getEmbeddingConfig } from "@/lib/embeddings/embed";
import { buildCompanyChunkHash, type PlannedTableSelection } from "@/lib/creeper/plans";

function toJsonInput(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function parsePlannedTableSelections(value: unknown): PlannedTableSelection[] {
  return Array.isArray(value) ? value as unknown as PlannedTableSelection[] : [];
}

function formatTableChunk(table: PlannedTableSelection, tableProfile: {
  tableType: string;
  primaryKey: unknown;
  foreignKeys: unknown;
  classification: unknown;
} | null): string {
  const lines = [
    `Table ${table.schemaName}.${table.tableName}`,
    `Estimated rows: ${table.estimatedRowCount ?? "unknown"}`,
    `Ingestion score: ${table.ingestionScore ?? "unknown"}`,
    `Selected columns: ${table.selectedColumns.join(", ") || "none"}`,
  ];

  if (tableProfile) {
    lines.push(`Table type: ${tableProfile.tableType}`);
    lines.push(`Primary key: ${JSON.stringify(tableProfile.primaryKey ?? [])}`);
    lines.push(`Foreign keys: ${JSON.stringify(tableProfile.foreignKeys ?? [])}`);
    lines.push(`Classification: ${JSON.stringify(tableProfile.classification ?? {})}`);
  }

  return lines.join("\n");
}

export async function processCreeperIngestionJob(data: { runId: string; planId: string; companyProfileId: string; sourceId: string }) {
  const run = await db.companyIngestionRun.findUnique({
    where: { id: data.runId },
    include: {
      plan: true,
    },
  });

  if (!run) {
    throw new Error(`Unknown ingestion run '${data.runId}'.`);
  }

  const selectedTables = parsePlannedTableSelections(run.plan.selectedTables);
  const embeddingConfig = getEmbeddingConfig();

  await db.companyIngestionRun.update({
    where: { id: run.id },
    data: {
      status: CompanyIngestionRunStatus.RUNNING,
      stage: "building_chunks",
      startedAt: run.startedAt ?? new Date(),
    },
  });

  const latestScan = await db.sourceScan.findFirst({
    where: { sourceId: data.sourceId, status: SourceScanStatus.SUCCEEDED },
    orderBy: { createdAt: "desc" },
    include: {
      tableProfiles: true,
    },
  });

  if (!latestScan) {
    throw new Error("No successful source scan is available for ingestion.");
  }

  const chunkDrafts = selectedTables.map((table) => {
    const profile = latestScan.tableProfiles.find((entry) => entry.schemaName === table.schemaName && entry.tableName === table.tableName) ?? null;
    const content = formatTableChunk(table, profile);
    return {
      schemaName: table.schemaName,
      tableName: table.tableName,
      content,
      contentHash: buildCompanyChunkHash([run.planId, table.id, content]),
      metadata: {
        sourceScanId: latestScan.id,
        selectedColumns: table.selectedColumns,
        estimatedRowCount: table.estimatedRowCount,
        ingestionScore: table.ingestionScore,
      },
    };
  });

  const createdChunks = await Promise.all(chunkDrafts.map((draft) => db.companyKnowledgeChunk.create({
    data: {
      companyProfileId: data.companyProfileId,
      sourceId: data.sourceId,
      runId: run.id,
      schemaName: draft.schemaName,
      tableName: draft.tableName,
      chunkKind: CompanyChunkKind.JSON_SUMMARY,
      title: `${draft.schemaName}.${draft.tableName}`,
      content: draft.content,
      contentHash: draft.contentHash,
      tokenEstimate: Math.ceil(draft.content.length / 4),
      metadata: toJsonInput(draft.metadata),
    },
  })));

  const embeddings = createdChunks.length > 0 ? await embedBatch(createdChunks.map((chunk) => chunk.content), "document") : [];

  await Promise.all(createdChunks.map(async (chunk, index) => {
    const embedding = embeddings[index];
    if (!embedding) {
      return;
    }

    const record = await db.companyKnowledgeEmbedding.create({
      data: {
        chunkId: chunk.id,
        model: embeddingConfig.model,
        dimensions: embeddingConfig.dimensions,
      },
    });

    await db.$executeRawUnsafe(
      `UPDATE "CompanyKnowledgeEmbedding" SET embedding = $1::vector WHERE id = $2`,
      formatEmbedding(embedding),
      record.id,
    );
  }));

  await db.companyIngestionRun.update({
    where: { id: run.id },
    data: {
      status: CompanyIngestionRunStatus.SUCCEEDED,
      stage: "completed",
      completedAt: new Date(),
      counters: toJsonInput({
        chunksCreated: createdChunks.length,
        embeddingsCreated: embeddings.length,
        selectedTableCount: selectedTables.length,
      }),
    },
  });

  return {
    runId: run.id,
    chunksCreated: createdChunks.length,
    embeddingsCreated: embeddings.length,
  };
}