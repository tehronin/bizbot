import { ExternalDataSourceStatus } from "@prisma/client";
import { defineTool, registerTool, type ToolDefinition } from "@/lib/agent/tools";
import { updateConversationCompanyProfile } from "@/lib/agent/memory";
import { isBuiltinPluginEnabled } from "@/lib/agent/plugins/settings";
import { requireConversationCompanyProfileId } from "@/lib/creeper/conversations";
import {
  approveCreeperPlan,
  createDraftCreeperPlan,
  getCreeperPlan,
  startCreeperIngestionRun,
  updateCreeperPlan,
} from "@/lib/creeper/plans";
import { listCreeperCompanyProfiles, upsertCreeperCompanyBrief, getCreeperCompanyProfile } from "@/lib/creeper/profiles";
import { testExternalPostgresConnection } from "@/lib/creeper/postgres";
import { listCreeperSourceAssets, profileCreeperSource } from "@/lib/creeper/profiling";
import {
  buildCreeperCompanyBriefReviewSidecar,
  buildCreeperCompanyProfileSelectorSidecar,
  buildCreeperPlanReviewSidecar,
  buildCreeperSchemaCatalogSidecar,
  buildCreeperSourceOverviewSidecar,
} from "@/lib/creeper/sidecar";
import {
  getCreeperConnectedSource,
  registerCreeperSource,
  updateCreeperSourceStatus,
} from "@/lib/creeper/sources";
import {
  CREEPER_POSTGRES_SSL_MODES,
  type CreeperSourceTestResult,
} from "@/lib/creeper/types";
import type { SidecarToolResult } from "@/lib/sidecar/types";

interface CreeperRegisterSourceArgs {
  companyName?: string;
  companyProfileId?: string;
  sourceLabel: string;
  host: string;
  port?: number;
  database: string;
  username: string;
  password: string;
  sslMode?: string;
  sslRejectUnauthorized?: boolean;
  allowedSchemas?: string[];
  notes?: string;
  testOnCreate?: boolean;
}

interface CreeperTestSourceConnectionArgs {
  sourceId: string;
}

interface CreeperProfileSourceArgs {
  sourceId: string;
  schemaAllowlist?: string[];
  maxTables?: number;
  sampleRowsPerTable?: number;
  includeRowEstimates?: boolean;
}

interface CreeperListSourceAssetsArgs {
  sourceId: string;
  schema?: string;
  includeColumns?: boolean;
  includeStats?: boolean;
}

interface CreeperOpenSourceSidecarArgs {
  sourceId?: string;
  companyProfileId?: string;
  planId?: string;
  runId?: string;
  view: "overview" | "schema" | "table" | "plan" | "progress" | "graph";
}

interface CreeperSelectCompanyProfileArgs {
  companyProfileId: string;
}

interface CreeperCompanyBriefArgs {
  companyProfileId?: string;
  companyName?: string;
  businessDescription: string;
  desiredOutcomes?: string[];
  includeDomains?: string[];
  excludeDomains?: string[];
  timeHorizon?: string;
  importantConcepts?: string[];
  notes?: string;
}

interface CreeperListCompanyProfilesArgs {
  limit?: number;
}

interface CreeperGetCompanyProfileArgs {
  companyProfileId: string;
}

interface CreeperOpenCompanySelectorArgs {
  openMode?: "selector" | "review";
  companyProfileId?: string;
}

interface CreeperDraftPlanArgs {
  companyProfileId?: string;
  sourceId?: string;
  businessGoal?: string;
  maxTables?: number;
}

interface CreeperUpdatePlanArgs {
  planId: string;
  selectedTableIds?: string[];
  businessGoal?: string;
}

interface CreeperPlanArgs {
  planId: string;
}

function ensureCreeperEnabled(): void {
  if (!isBuiltinPluginEnabled("creeper")) {
    throw new Error("Creeper plugin is disabled.");
  }
}

async function runCreeperConnectionTest(sourceId: string): Promise<CreeperSourceTestResult> {
  const connectedSource = await getCreeperConnectedSource(sourceId);
  const result = await testExternalPostgresConnection(connectedSource.source, connectedSource.password);
  await updateCreeperSourceStatus(
    connectedSource.source.id,
    result.ok ? ExternalDataSourceStatus.READY : ExternalDataSourceStatus.FAILED,
    { lastTestedAt: new Date() },
  );

  if (!result.ok) {
    throw new Error(`Source is reachable but does not satisfy Creeper read-only posture rules: ${result.readOnlyAssessment.reasons.join("; ")}`);
  }

  return result;
}

async function buildSidecarForView(args: CreeperOpenSourceSidecarArgs): Promise<SidecarToolResult> {
  if (args.companyProfileId) {
    return buildCreeperCompanyBriefReviewSidecar(args.companyProfileId);
  }

  if (args.planId) {
    return buildCreeperPlanReviewSidecar(args.planId);
  }

  if (!args.sourceId) {
    throw new Error("sourceId is required for Creeper source Sidecar views.");
  }

  switch (args.view) {
    case "overview":
      return buildCreeperSourceOverviewSidecar(args.sourceId);
    case "schema":
      return buildCreeperSchemaCatalogSidecar(args.sourceId);
    default:
      throw new Error(`Creeper view '${args.view}' is not implemented yet.`);
  }
}

export const creeperPlugin = {
  tools: [
    registerTool(defineTool({
      name: "creeper_list_company_profiles",
      description: "List the existing Creeper company profiles so the user can reopen a company or start a new one deliberately.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Maximum company profiles to return. Defaults to 24." },
        },
        additionalProperties: false,
      },
      execute: async (args: CreeperListCompanyProfilesArgs) => {
        ensureCreeperEnabled();
        return {
          profiles: await listCreeperCompanyProfiles(args.limit ?? 24),
        };
      },
    } satisfies ToolDefinition<CreeperListCompanyProfilesArgs, { profiles: Awaited<ReturnType<typeof listCreeperCompanyProfiles>> }>)),
    registerTool(defineTool({
      name: "creeper_prepare_company_brief",
      description: "Create or update a company profile brief before any database investigation begins, including goals, scope, and exclusions.",
      parameters: {
        type: "object",
        properties: {
          companyProfileId: { type: "string", description: "Existing company profile id to update." },
          companyName: { type: "string", description: "Company name when starting a new profile." },
          businessDescription: { type: "string", description: "Plain-English description of what the business does." },
          desiredOutcomes: { type: "array", items: { type: "string" }, description: "What the user wants to learn or do with the data." },
          includeDomains: { type: "array", items: { type: "string" }, description: "Business-specific domains or records to include." },
          excludeDomains: { type: "array", items: { type: "string" }, description: "Business-specific domains or records to exclude." },
          timeHorizon: { type: "string", description: "Optional time horizon such as last quarter, last five years, or all-time." },
          importantConcepts: { type: "array", items: { type: "string" }, description: "Important business entities or concepts to preserve during ingestion planning." },
          notes: { type: "string", description: "Extra constraints, caveats, or priorities." },
        },
        required: ["businessDescription"],
        additionalProperties: false,
      },
      execute: async (args: CreeperCompanyBriefArgs) => {
        ensureCreeperEnabled();
        const profile = await upsertCreeperCompanyBrief(args);
        return {
          companyProfileId: profile.id,
          companyName: profile.name,
          slug: profile.slug,
          status: profile.status,
          _sidecar: await buildCreeperCompanyBriefReviewSidecar(profile.id),
        };
      },
    } satisfies ToolDefinition<CreeperCompanyBriefArgs, { companyProfileId: string; companyName: string; slug: string; status: string; _sidecar: SidecarToolResult }>)),
    registerTool(defineTool({
      name: "creeper_get_company_profile",
      description: "Return one company profile with its current onboarding brief, sources, and recent ingestion plans.",
      parameters: {
        type: "object",
        properties: {
          companyProfileId: { type: "string", description: "Existing company profile id." },
        },
        required: ["companyProfileId"],
        additionalProperties: false,
      },
      execute: async (args: CreeperGetCompanyProfileArgs) => {
        ensureCreeperEnabled();
        return getCreeperCompanyProfile(args.companyProfileId);
      },
    } satisfies ToolDefinition<CreeperGetCompanyProfileArgs, Awaited<ReturnType<typeof getCreeperCompanyProfile>>>)),
    registerTool(defineTool({
      name: "creeper_select_company_profile",
      description: "Persist the active company profile on the current conversation so later Creeper turns draft plans and ingest into the same company context.",
      parameters: {
        type: "object",
        properties: {
          companyProfileId: { type: "string", description: "Existing company profile id to make active for this conversation." },
        },
        required: ["companyProfileId"],
        additionalProperties: false,
      },
      execute: async (args: CreeperSelectCompanyProfileArgs, context) => {
        ensureCreeperEnabled();
        if (!context.conversationId) {
          throw new Error("A conversation is required before selecting a company profile.");
        }
        await updateConversationCompanyProfile(context.conversationId, args.companyProfileId);
        return {
          companyProfileId: args.companyProfileId,
          _sidecar: await buildCreeperCompanyBriefReviewSidecar(args.companyProfileId),
        };
      },
    } satisfies ToolDefinition<CreeperSelectCompanyProfileArgs, { companyProfileId: string; _sidecar: SidecarToolResult }>)),
    registerTool(defineTool({
      name: "creeper_open_company_selector",
      description: "Open a Sidecar panel to review existing company profiles or show the stored onboarding brief for one selected company.",
      parameters: {
        type: "object",
        properties: {
          openMode: { type: "string", enum: ["selector", "review"], description: "Whether to open the company selector or a specific company review panel." },
          companyProfileId: { type: "string", description: "Company profile id when opening a specific review panel." },
        },
        additionalProperties: false,
      },
      execute: async (args: CreeperOpenCompanySelectorArgs) => {
        ensureCreeperEnabled();
        return {
          _sidecar: args.openMode === "review" && args.companyProfileId
            ? await buildCreeperCompanyBriefReviewSidecar(args.companyProfileId)
            : await buildCreeperCompanyProfileSelectorSidecar(),
        };
      },
    } satisfies ToolDefinition<CreeperOpenCompanySelectorArgs, { _sidecar: SidecarToolResult }>)),
    registerTool(defineTool({
      name: "creeper_draft_ingestion_plan",
      description: "Draft a company-scoped ingestion plan from the latest Creeper profile so tables can be reviewed before ingestion begins.",
      parameters: {
        type: "object",
        properties: {
          companyProfileId: { type: "string", description: "Optional company profile id. Defaults to the company selected on the conversation." },
          sourceId: { type: "string", description: "Optional source id when a company has multiple sources." },
          businessGoal: { type: "string", description: "Optional plan-specific business goal or decision the ingestion should support." },
          maxTables: { type: "number", description: "Maximum tables to include in the initial plan draft." },
        },
        additionalProperties: false,
      },
      execute: async (args: CreeperDraftPlanArgs, context) => {
        ensureCreeperEnabled();
        const companyProfileId = args.companyProfileId ?? await requireConversationCompanyProfileId(context.conversationId);
        const plan = await createDraftCreeperPlan({
          companyProfileId,
          sourceId: args.sourceId,
          businessGoal: args.businessGoal,
          maxTables: args.maxTables,
          conversationId: context.conversationId,
        });
        return {
          plan,
          _sidecar: await buildCreeperPlanReviewSidecar(plan.id),
        };
      },
    } satisfies ToolDefinition<CreeperDraftPlanArgs, { plan: Awaited<ReturnType<typeof createDraftCreeperPlan>>; _sidecar: SidecarToolResult }>)),
    registerTool(defineTool({
      name: "creeper_update_ingestion_plan",
      description: "Update the selected tables or business goal for an existing Creeper ingestion plan before approval.",
      parameters: {
        type: "object",
        properties: {
          planId: { type: "string", description: "Plan id to update." },
          selectedTableIds: { type: "array", items: { type: "string" }, description: "Optional full replacement list of selected table ids such as public.orders." },
          businessGoal: { type: "string", description: "Optional updated business goal." },
        },
        required: ["planId"],
        additionalProperties: false,
      },
      execute: async (args: CreeperUpdatePlanArgs) => {
        ensureCreeperEnabled();
        const plan = await updateCreeperPlan(args);
        return {
          plan,
          _sidecar: await buildCreeperPlanReviewSidecar(plan.id),
        };
      },
    } satisfies ToolDefinition<CreeperUpdatePlanArgs, { plan: Awaited<ReturnType<typeof updateCreeperPlan>>; _sidecar: SidecarToolResult }>)),
    registerTool(defineTool({
      name: "creeper_approve_ingestion_plan",
      description: "Approve a drafted Creeper ingestion plan so it becomes the active plan for the selected company.",
      parameters: {
        type: "object",
        properties: {
          planId: { type: "string", description: "Plan id to approve." },
        },
        required: ["planId"],
        additionalProperties: false,
      },
      execute: async (args: CreeperPlanArgs) => {
        ensureCreeperEnabled();
        const plan = await approveCreeperPlan(args.planId);
        return {
          plan,
          _sidecar: await buildCreeperPlanReviewSidecar(plan.id),
        };
      },
    } satisfies ToolDefinition<CreeperPlanArgs, { plan: Awaited<ReturnType<typeof approveCreeperPlan>>; _sidecar: SidecarToolResult }>)),
    registerTool(defineTool({
      name: "creeper_start_ingestion_run",
      description: "Queue an approved Creeper ingestion plan for worker execution and return the queued run record.",
      parameters: {
        type: "object",
        properties: {
          planId: { type: "string", description: "Approved plan id to run." },
        },
        required: ["planId"],
        additionalProperties: false,
      },
      execute: async (args: CreeperPlanArgs) => {
        ensureCreeperEnabled();
        const run = await startCreeperIngestionRun(args.planId);
        const plan = await getCreeperPlan(args.planId);
        return {
          run,
          plan,
          _sidecar: await buildCreeperPlanReviewSidecar(args.planId),
        };
      },
    } satisfies ToolDefinition<CreeperPlanArgs, { run: Awaited<ReturnType<typeof startCreeperIngestionRun>>; plan: Awaited<ReturnType<typeof getCreeperPlan>>; _sidecar: SidecarToolResult }>)),
    registerTool(defineTool({
      name: "creeper_register_source",
      description: "Register a read-only Postgres company source and persist encrypted credentials for later bounded inspection.",
      parameters: {
        type: "object",
        properties: {
          companyName: { type: "string", description: "Company name when creating a new company profile alongside the source." },
          companyProfileId: { type: "string", description: "Existing company profile id to attach this source to." },
          sourceLabel: { type: "string", description: "Human-readable label for the source." },
          host: { type: "string", description: "Postgres host name." },
          port: { type: "number", description: "Postgres port. Defaults to 5432." },
          database: { type: "string", description: "Database name." },
          username: { type: "string", description: "Read-only database username." },
          password: { type: "string", description: "Database password. Stored encrypted after registration." },
          sslMode: { type: "string", enum: [...CREEPER_POSTGRES_SSL_MODES], description: "Postgres SSL mode." },
          sslRejectUnauthorized: { type: "boolean", description: "Whether to reject unauthorized TLS certificates." },
          allowedSchemas: {
            type: "array",
            description: "Optional schema allowlist enforced by future profiling and ingestion steps.",
            items: { type: "string" },
          },
          notes: { type: "string", description: "Optional operator notes." },
          testOnCreate: { type: "boolean", description: "Whether to run a bounded connection test immediately after persistence." },
        },
        required: ["sourceLabel", "host", "database", "username", "password"],
        additionalProperties: false,
      },
      execute: async (args: CreeperRegisterSourceArgs) => {
        ensureCreeperEnabled();
        const registration = await registerCreeperSource({
          companyProfileId: args.companyProfileId,
          companyName: args.companyName,
          sourceLabel: args.sourceLabel,
          host: args.host,
          port: args.port,
          database: args.database,
          username: args.username,
          password: args.password,
          sslMode: args.sslMode as typeof CREEPER_POSTGRES_SSL_MODES[number] | undefined,
          sslRejectUnauthorized: args.sslRejectUnauthorized,
          allowedSchemas: args.allowedSchemas,
          notes: args.notes,
        });

        const connectionTest = args.testOnCreate ? await runCreeperConnectionTest(registration.sourceId) : null;

        return {
          sourceId: registration.sourceId,
          companyProfileId: registration.companyProfileId,
          connectionSummary: registration.connectionSummary,
          status: connectionTest ? ExternalDataSourceStatus.READY : registration.status,
          ...(connectionTest ? { connectionTest } : {}),
        };
      },
    } satisfies ToolDefinition<CreeperRegisterSourceArgs, {
      sourceId: string;
      companyProfileId: string;
      connectionSummary: ReturnType<typeof registerCreeperSource> extends Promise<infer TResult> ? TResult extends { connectionSummary: infer TSummary } ? TSummary : never : never;
      status: ExternalDataSourceStatus;
      connectionTest?: CreeperSourceTestResult;
    }>)),
    registerTool(defineTool({
      name: "creeper_test_source_connection",
      description: "Verify that a registered Postgres source is reachable and strictly read-only before any profiling work begins.",
      parameters: {
        type: "object",
        properties: {
          sourceId: { type: "string", description: "Registered Creeper source id." },
        },
        required: ["sourceId"],
        additionalProperties: false,
      },
      execute: async (args: CreeperTestSourceConnectionArgs) => {
        ensureCreeperEnabled();
        return runCreeperConnectionTest(args.sourceId);
      },
    } satisfies ToolDefinition<CreeperTestSourceConnectionArgs, CreeperSourceTestResult>)),
    registerTool(defineTool({
      name: "creeper_profile_source",
      description: "Run bounded Postgres schema profiling and persist catalog artifacts for later planning and review.",
      parameters: {
        type: "object",
        properties: {
          sourceId: { type: "string", description: "Registered Creeper source id." },
          schemaAllowlist: {
            type: "array",
            description: "Optional schema allowlist for this profile run.",
            items: { type: "string" },
          },
          maxTables: { type: "number", description: "Maximum tables or views to profile. Defaults to 50 and is capped at 200." },
          sampleRowsPerTable: { type: "number", description: "Reserved for later sampling support. Present for forward compatibility." },
          includeRowEstimates: { type: "boolean", description: "Whether to persist estimated row counts when available." },
        },
        required: ["sourceId"],
        additionalProperties: false,
      },
      execute: async (args: CreeperProfileSourceArgs) => {
        ensureCreeperEnabled();
        const result = await profileCreeperSource({
          sourceId: args.sourceId,
          schemaAllowlist: args.schemaAllowlist,
          maxTables: args.maxTables,
          includeRowEstimates: args.includeRowEstimates,
        });
        return {
          ...result,
          _sidecar: await buildCreeperSourceOverviewSidecar(args.sourceId),
        };
      },
    } satisfies ToolDefinition<CreeperProfileSourceArgs, Awaited<ReturnType<typeof profileCreeperSource>> & { _sidecar: SidecarToolResult }>)),
    registerTool(defineTool({
      name: "creeper_list_source_assets",
      description: "Return persisted source schemas, tables, and optional column details from the latest successful profile run.",
      parameters: {
        type: "object",
        properties: {
          sourceId: { type: "string", description: "Registered Creeper source id." },
          schema: { type: "string", description: "Optional schema filter for the stored inventory." },
          includeColumns: { type: "boolean", description: "Whether to include column-level artifacts." },
          includeStats: { type: "boolean", description: "Whether to include persisted table and column statistics." },
        },
        required: ["sourceId"],
        additionalProperties: false,
      },
      execute: async (args: CreeperListSourceAssetsArgs) => {
        ensureCreeperEnabled();
        return listCreeperSourceAssets(args.sourceId, {
          schema: args.schema,
          includeColumns: args.includeColumns,
          includeStats: args.includeStats,
        });
      },
    } satisfies ToolDefinition<CreeperListSourceAssetsArgs, Awaited<ReturnType<typeof listCreeperSourceAssets>>>)),
    registerTool(defineTool({
      name: "creeper_open_source_sidecar",
      description: "Open a Creeper Sidecar panel for a stored source overview or schema inventory.",
      parameters: {
        type: "object",
        properties: {
          sourceId: { type: "string", description: "Registered Creeper source id." },
          companyProfileId: { type: "string", description: "Company profile id for opening a company brief review instead of a source panel." },
          planId: { type: "string", description: "Reserved for later plan review panels." },
          runId: { type: "string", description: "Reserved for later run progress panels." },
          view: {
            type: "string",
            enum: ["overview", "schema", "table", "plan", "progress", "graph"],
            description: "Which stored Creeper panel to open.",
          },
        },
        required: ["view"],
        additionalProperties: false,
      },
      execute: async (args: CreeperOpenSourceSidecarArgs) => {
        ensureCreeperEnabled();
        return {
          view: args.view,
          _sidecar: await buildSidecarForView(args),
        };
      },
    } satisfies ToolDefinition<CreeperOpenSourceSidecarArgs, { view: CreeperOpenSourceSidecarArgs["view"]; _sidecar: SidecarToolResult }>)),
  ],
};