/** CrmPlugin — Inbox-backed CRM tools with external provider sync support. */

import { LeadStage } from "@prisma/client";
import {
  createCrmContactActivity,
  CRM_PROVIDER_NAMES,
  CRM_STAGE_NAMES,
  createCrmContactFromInbox,
  getCrmContactActivity,
  getCrmContact,
  getCrmProviderStatuses,
  listCrmContactActivities,
  listCrmContacts,
  syncCrmActivity,
  syncCrmContact,
  upsertCrmContact,
  type CrmActivityPriority,
  type CrmActivityStatus,
  type CrmActivityType,
  type CrmProviderName,
} from "@/lib/crm";
import { defineTool, registerTool, type ToolDefinition } from "@/lib/agent/tools";

type CrmProviderStatusArgs = Record<string, never>;

interface CrmListContactsArgs {
  stage?: LeadStage;
  query?: string;
  limit?: number;
}

interface CrmGetContactArgs {
  contactId: string;
}

interface CrmUpsertContactArgs {
  contactId: string;
  stage?: LeadStage;
  score?: number;
  summary?: string;
  clearSummary?: boolean;
}

interface CrmCreateContactFromInboxArgs {
  inboxMessageId: string;
  stage?: LeadStage;
  score?: number;
  summary?: string;
}

interface CrmSyncContactArgs {
  contactId: string;
  provider?: CrmProviderName;
}

interface CrmListActivitiesArgs {
  contactId?: string;
  type?: CrmActivityType;
  status?: CrmActivityStatus;
  query?: string;
  limit?: number;
}

interface CrmCreateActivityArgs {
  contactId: string;
  type: CrmActivityType;
  title?: string;
  subject?: string;
  body: string;
  status?: CrmActivityStatus;
  priority?: CrmActivityPriority;
  dueAt?: string;
}

interface CrmGetActivityArgs {
  activityId: string;
}

interface CrmSyncActivityArgs {
  activityId: string;
  provider?: CrmProviderName;
}

export const crmPlugin = {
  tools: [
    registerTool(defineTool({
      name: "crm_get_provider_status",
      description: "Inspect CRM provider availability, active provider selection, and HubSpot stub readiness.",
      parameters: { type: "object", properties: {} },
      execute: async (_args: CrmProviderStatusArgs) => ({
        activeProvider: process.env.CRM_PROVIDER?.trim() === "hubspot" ? "hubspot" : "internal",
        providers: await getCrmProviderStatuses(),
      }),
    } satisfies ToolDefinition<CrmProviderStatusArgs, { activeProvider: CrmProviderName; providers: Awaited<ReturnType<typeof getCrmProviderStatuses>> }>)),
    registerTool(defineTool({
      name: "crm_list_contacts",
      description: "List inbox-backed CRM contacts and leads, optionally filtered by stage or text query.",
      parameters: {
        type: "object",
        properties: {
          stage: { type: "string", enum: [...CRM_STAGE_NAMES] },
          query: { type: "string" },
          limit: { type: "number", default: 25 },
        },
      },
      execute: async ({ stage, query, limit }: CrmListContactsArgs) => ({
        contacts: await listCrmContacts({ stage, query, limit: limit ?? 25 }),
      }),
    } satisfies ToolDefinition<CrmListContactsArgs, { contacts: Awaited<ReturnType<typeof listCrmContacts>> }>)),
    registerTool(defineTool({
      name: "crm_get_contact",
      description: "Get a single CRM contact by BizBot contact id.",
      parameters: {
        type: "object",
        properties: {
          contactId: { type: "string" },
        },
        required: ["contactId"],
      },
      execute: async ({ contactId }: CrmGetContactArgs) => {
        const contact = await getCrmContact(contactId);
        if (!contact) {
          throw new Error(`CRM contact not found: ${contactId}`);
        }
        return { contact };
      },
    } satisfies ToolDefinition<CrmGetContactArgs, { contact: NonNullable<Awaited<ReturnType<typeof getCrmContact>>> }>)),
    registerTool(defineTool({
      name: "crm_upsert_contact",
      description: "Update CRM lead stage, score, or summary for an inbox-backed contact.",
      parameters: {
        type: "object",
        properties: {
          contactId: { type: "string" },
          stage: { type: "string", enum: [...CRM_STAGE_NAMES] },
          score: { type: "number" },
          summary: { type: "string" },
          clearSummary: { type: "boolean", default: false },
        },
        required: ["contactId"],
      },
      execute: async ({ contactId, stage, score, summary, clearSummary }: CrmUpsertContactArgs) => ({
        contact: await upsertCrmContact({
          contactId,
          ...(stage !== undefined ? { stage } : {}),
          ...(score !== undefined ? { score } : {}),
          ...(clearSummary ? { summary: null } : summary !== undefined ? { summary } : {}),
        }),
      }),
    } satisfies ToolDefinition<CrmUpsertContactArgs, { contact: Awaited<ReturnType<typeof upsertCrmContact>> }>)),
    registerTool(defineTool({
      name: "crm_create_contact_from_inbox",
      description: "Promote an inbox item into the CRM pipeline with an initial stage, score, and summary.",
      parameters: {
        type: "object",
        properties: {
          inboxMessageId: { type: "string" },
          stage: { type: "string", enum: [...CRM_STAGE_NAMES], default: LeadStage.LEAD },
          score: { type: "number" },
          summary: { type: "string" },
        },
        required: ["inboxMessageId"],
      },
      execute: async ({ inboxMessageId, stage, score, summary }: CrmCreateContactFromInboxArgs) => ({
        contact: await createCrmContactFromInbox({
          inboxMessageId,
          stage: stage ?? LeadStage.LEAD,
          ...(score !== undefined ? { score } : {}),
          ...(summary !== undefined ? { summary } : {}),
        }),
      }),
    } satisfies ToolDefinition<CrmCreateContactFromInboxArgs, { contact: Awaited<ReturnType<typeof createCrmContactFromInbox>> }>)),
    registerTool(defineTool({
      name: "crm_sync_contact",
      description: "Sync a CRM contact to the selected provider.",
      parameters: {
        type: "object",
        properties: {
          contactId: { type: "string" },
          provider: { type: "string", enum: [...CRM_PROVIDER_NAMES] },
        },
        required: ["contactId"],
      },
      execute: async ({ contactId, provider }: CrmSyncContactArgs) => ({
        sync: await syncCrmContact(contactId, provider),
      }),
    } satisfies ToolDefinition<CrmSyncContactArgs, { sync: Awaited<ReturnType<typeof syncCrmContact>> }>)),
    registerTool(defineTool({
      name: "crm_list_activities",
      description: "List CRM notes and follow-up tasks, optionally scoped to a contact, type, status, or text query.",
      parameters: {
        type: "object",
        properties: {
          contactId: { type: "string" },
          type: { type: "string", enum: ["note", "task"] },
          status: { type: "string", enum: ["logged", "pending", "completed"] },
          query: { type: "string" },
          limit: { type: "number", default: 25 },
        },
      },
      execute: async ({ contactId, type, status, query, limit }: CrmListActivitiesArgs) => ({
        activities: await listCrmContactActivities({
          contactId,
          type,
          status,
          query,
          limit: limit ?? 25,
        }),
      }),
    } satisfies ToolDefinition<CrmListActivitiesArgs, { activities: Awaited<ReturnType<typeof listCrmContactActivities>> }>)),
    registerTool(defineTool({
      name: "crm_get_activity",
      description: "Get a single CRM note or task by activity id.",
      parameters: {
        type: "object",
        properties: {
          activityId: { type: "string" },
        },
        required: ["activityId"],
      },
      execute: async ({ activityId }: CrmGetActivityArgs) => {
        const activity = await getCrmContactActivity(activityId);
        if (!activity) {
          throw new Error(`CRM activity not found: ${activityId}`);
        }
        return { activity };
      },
    } satisfies ToolDefinition<CrmGetActivityArgs, { activity: NonNullable<Awaited<ReturnType<typeof getCrmContactActivity>>> }>)),
    registerTool(defineTool({
      name: "crm_create_activity",
      description: "Create a local CRM note or follow-up task for a contact.",
      parameters: {
        type: "object",
        properties: {
          contactId: { type: "string" },
          type: { type: "string", enum: ["note", "task"] },
          title: { type: "string" },
          subject: { type: "string" },
          body: { type: "string" },
          status: { type: "string", enum: ["logged", "pending", "completed"] },
          priority: { type: "string", enum: ["low", "medium", "high"] },
          dueAt: { type: "string" },
        },
        required: ["contactId", "type", "body"],
      },
      execute: async ({ contactId, type, title, subject, body, status, priority, dueAt }: CrmCreateActivityArgs) => ({
        activity: await createCrmContactActivity({
          contactId,
          type,
          title,
          subject,
          body,
          status,
          priority,
          dueAt,
        }),
      }),
    } satisfies ToolDefinition<CrmCreateActivityArgs, { activity: Awaited<ReturnType<typeof createCrmContactActivity>> }>)),
    registerTool(defineTool({
      name: "crm_sync_activity",
      description: "Sync a CRM note or task to the selected provider. HubSpot creates a real associated note or task in live mode.",
      parameters: {
        type: "object",
        properties: {
          activityId: { type: "string" },
          provider: { type: "string", enum: [...CRM_PROVIDER_NAMES] },
        },
        required: ["activityId"],
      },
      execute: async ({ activityId, provider }: CrmSyncActivityArgs) => ({
        sync: await syncCrmActivity(activityId, provider),
      }),
    } satisfies ToolDefinition<CrmSyncActivityArgs, { sync: Awaited<ReturnType<typeof syncCrmActivity>> }>)),
  ],
};