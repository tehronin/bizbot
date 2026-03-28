import {
  createCrmContactActivity,
  createCrmContactFromInbox,
  getCrmContact,
  getCrmContactActivity,
  getCrmProviderStatuses,
  listCrmContactActivities,
  listCrmContacts,
  syncCrmActivity,
  syncCrmContact,
  upsertCrmContact,
} from "@/lib/crm";
import type { CrmProviderName } from "@/lib/crm";

type CrmPluginDeps = {
  getProviderStatuses: typeof getCrmProviderStatuses;
  getActiveProviderName: () => CrmProviderName;
  listContacts: typeof listCrmContacts;
  getContact: typeof getCrmContact;
  upsertContact: typeof upsertCrmContact;
  createContactFromInbox: typeof createCrmContactFromInbox;
  syncContact: typeof syncCrmContact;
  listActivities: typeof listCrmContactActivities;
  getActivity: typeof getCrmContactActivity;
  createActivity: typeof createCrmContactActivity;
  syncActivity: typeof syncCrmActivity;
};

const defaultDeps: CrmPluginDeps = {
  getProviderStatuses: getCrmProviderStatuses,
  getActiveProviderName: () => (process.env.CRM_PROVIDER?.trim() === "hubspot" ? "hubspot" : "internal"),
  listContacts: listCrmContacts,
  getContact: getCrmContact,
  upsertContact: upsertCrmContact,
  createContactFromInbox: createCrmContactFromInbox,
  syncContact: syncCrmContact,
  listActivities: listCrmContactActivities,
  getActivity: getCrmContactActivity,
  createActivity: createCrmContactActivity,
  syncActivity: syncCrmActivity,
};

let currentDeps: CrmPluginDeps = defaultDeps;

export function getCrmPluginDeps(): CrmPluginDeps {
  return currentDeps;
}

export function setCrmPluginTestDeps(overrides: Partial<CrmPluginDeps>): void {
  currentDeps = { ...defaultDeps, ...overrides };
}

export function resetCrmPluginTestDeps(): void {
  currentDeps = defaultDeps;
}