import { LeadStage, type InboxMessage, type Platform } from "@prisma/client";
import { db } from "@/lib/db";
import { updateLeadPipelineItem } from "@/lib/inbox/leads";
import type {
  CrmActivity,
  CrmActivitySyncResult,
  CrmContact,
  CrmContactFilters,
  CrmContactStore,
  CrmContactUpdateInput,
  CrmCreateContactFromInboxInput,
  CrmProvider,
  CrmProviderStatus,
  CrmSyncResult,
} from "@/lib/crm/types";

type InboxContactRecord = InboxMessage & {
  platform: Platform;
};

function mapInboxMessageToContact(record: InboxContactRecord): CrmContact {
  return {
    id: record.id,
    source: "inbox",
    displayName: record.authorName,
    handle: record.authorHandle,
    platformId: record.platformId,
    platformName: record.platform.displayName,
    stage: record.leadStage,
    score: record.leadScore,
    summary: record.leadSummary,
    externalId: record.externalId,
    threadId: record.threadId,
    status: record.status,
    lastInboundAt: record.receivedAt.toISOString(),
    lastProcessedAt: record.processedAt?.toISOString() ?? null,
  };
}

export class InternalCrmStore implements CrmContactStore {
  async listContacts(filters: CrmContactFilters = {}): Promise<CrmContact[]> {
    const limit = Math.min(Math.max(filters.limit ?? 25, 1), 100);
    const query = filters.query?.trim();

    const items = await db.inboxMessage.findMany({
      where: {
        leadStage: filters.stage ?? { not: LeadStage.NONE },
        ...(query
          ? {
              OR: [
                { authorName: { contains: query, mode: "insensitive" } },
                { authorHandle: { contains: query, mode: "insensitive" } },
                { content: { contains: query, mode: "insensitive" } },
                { leadSummary: { contains: query, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: { platform: true },
      orderBy: [{ leadScore: "desc" }, { receivedAt: "desc" }],
      take: limit,
    });

    return items.map(mapInboxMessageToContact);
  }

  async getContact(contactId: string): Promise<CrmContact | null> {
    const item = await db.inboxMessage.findUnique({
      where: { id: contactId },
      include: { platform: true },
    });

    return item ? mapInboxMessageToContact(item) : null;
  }

  async upsertContact(input: CrmContactUpdateInput): Promise<CrmContact> {
    const item = await updateLeadPipelineItem(input.contactId, {
      ...(input.stage !== undefined ? { leadStage: input.stage } : {}),
      ...(input.score !== undefined ? { leadScore: Math.trunc(input.score) } : {}),
      ...(input.summary !== undefined ? { leadSummary: input.summary } : {}),
    });

    return mapInboxMessageToContact(item);
  }

  async createContactFromInbox(input: CrmCreateContactFromInboxInput): Promise<CrmContact> {
    const existing = await db.inboxMessage.findUnique({
      where: { id: input.inboxMessageId },
      select: { leadStage: true, leadScore: true, leadSummary: true },
    });

    if (!existing) {
      throw new Error(`Inbox message not found: ${input.inboxMessageId}`);
    }

    const item = await updateLeadPipelineItem(input.inboxMessageId, {
      leadStage: input.stage ?? (existing.leadStage === LeadStage.NONE ? LeadStage.LEAD : existing.leadStage),
      leadScore: input.score ?? (existing.leadScore > 0 ? existing.leadScore : 25),
      leadSummary: input.summary ?? existing.leadSummary,
    });

    return mapInboxMessageToContact(item);
  }
}

export class InternalCrmProvider implements CrmProvider {
  readonly name = "internal" as const;

  async getStatus(): Promise<CrmProviderStatus> {
    return {
      name: this.name,
      label: "Local Inbox CRM",
      active: (process.env.CRM_PROVIDER ?? "internal") === this.name,
      connected: true,
      mode: "local",
      details: {
        source: "prisma.inboxMessage",
        leadStagesManaged: true,
      },
    };
  }

  async syncContact(contact: CrmContact): Promise<CrmSyncResult> {
    return {
      ok: true,
      provider: this.name,
      mode: "local",
      contact,
      externalId: contact.externalId,
      message: "Contact is already stored locally in BizBot's inbox-backed CRM.",
    };
  }

  async syncActivity(contact: CrmContact, activity: CrmActivity): Promise<CrmActivitySyncResult> {
    return {
      ok: true,
      provider: this.name,
      mode: "local",
      activity,
      contact,
      externalId: activity.externalId ?? activity.id,
      message: "CRM activity is already stored locally in BizBot's activity journal.",
    };
  }
}

export { mapInboxMessageToContact };