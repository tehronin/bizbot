import { LeadStage } from "@prisma/client";
import { createCrmActivity, getCrmActivity, listCrmActivities, updateCrmActivity } from "@/lib/crm/activities";
import { HubSpotCrmProvider } from "@/lib/crm/hubspot";
import { InternalCrmProvider, InternalCrmStore } from "@/lib/crm/internal";
import type {
  CrmActivity,
  CrmActivityCreateInput,
  CrmActivityFilters,
  CrmActivityPriority,
  CrmActivityStatus,
  CrmActivityType,
  CrmActivityUpdateInput,
  CrmActivitySyncResult,
  CrmContact,
  CrmContactFilters,
  CrmContactStore,
  CrmContactUpdateInput,
  CrmCreateContactFromInboxInput,
  CrmProvider,
  CrmProviderName,
  CrmProviderStatus,
  CrmSyncResult,
} from "@/lib/crm/types";

const contactStore: CrmContactStore = new InternalCrmStore();

const providers: Record<CrmProviderName, CrmProvider> = {
  internal: new InternalCrmProvider(),
  hubspot: new HubSpotCrmProvider(),
};

export type {
  CrmActivity,
  CrmActivityCreateInput,
  CrmActivityFilters,
  CrmActivityPriority,
  CrmActivityStatus,
  CrmActivityType,
  CrmActivityUpdateInput,
  CrmContact,
  CrmContactFilters,
  CrmContactUpdateInput,
  CrmCreateContactFromInboxInput,
  CrmProviderName,
  CrmProviderStatus,
  CrmActivitySyncResult,
  CrmSyncResult,
};

export const CRM_PROVIDER_NAMES = Object.keys(providers) as CrmProviderName[];
export const CRM_STAGE_NAMES = [
  LeadStage.NONE,
  LeadStage.LEAD,
  LeadStage.QUALIFIED,
  LeadStage.CONTACTED,
  LeadStage.CONVERTED,
  LeadStage.LOST,
] as const;

export function getActiveCrmProvider(): CrmProviderName {
  const provider = process.env.CRM_PROVIDER?.trim();
  return provider === "hubspot" ? "hubspot" : "internal";
}

export function getCrmProvider(name: CrmProviderName = getActiveCrmProvider()): CrmProvider {
  return providers[name];
}

export async function getCrmProviderStatuses(): Promise<CrmProviderStatus[]> {
  return Promise.all(CRM_PROVIDER_NAMES.map((name) => providers[name].getStatus()));
}

export async function listCrmContacts(filters: CrmContactFilters = {}): Promise<CrmContact[]> {
  return contactStore.listContacts(filters);
}

export async function getCrmContact(contactId: string): Promise<CrmContact | null> {
  return contactStore.getContact(contactId);
}

export async function upsertCrmContact(input: CrmContactUpdateInput): Promise<CrmContact> {
  return contactStore.upsertContact(input);
}

export async function createCrmContactFromInbox(input: CrmCreateContactFromInboxInput): Promise<CrmContact> {
  return contactStore.createContactFromInbox(input);
}

export async function syncCrmContact(contactId: string, providerName = getActiveCrmProvider()): Promise<CrmSyncResult> {
  const contact = await getCrmContact(contactId);
  if (!contact) {
    throw new Error(`CRM contact not found: ${contactId}`);
  }

  return getCrmProvider(providerName).syncContact(contact);
}

export async function listCrmContactActivities(filters: CrmActivityFilters = {}): Promise<CrmActivity[]> {
  return listCrmActivities(filters);
}

export async function getCrmContactActivity(activityId: string): Promise<CrmActivity | null> {
  return getCrmActivity(activityId);
}

export async function createCrmContactActivity(input: CrmActivityCreateInput): Promise<CrmActivity> {
  return createCrmActivity(input);
}

export async function updateCrmContactActivity(input: CrmActivityUpdateInput): Promise<CrmActivity> {
  return updateCrmActivity(input);
}

export async function syncCrmActivity(activityId: string, providerName = getActiveCrmProvider()): Promise<CrmActivitySyncResult> {
  const activity = await getCrmActivity(activityId);
  if (!activity) {
    throw new Error(`CRM activity not found: ${activityId}`);
  }

  const contact = await getCrmContact(activity.contactId);
  if (!contact) {
    throw new Error(`CRM contact not found: ${activity.contactId}`);
  }

  return getCrmProvider(providerName).syncActivity(contact, activity);
}