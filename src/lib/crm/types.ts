import { LeadStage } from "@prisma/client";

export type CrmProviderName = "internal" | "hubspot";

export interface CrmContact {
  id: string;
  source: "inbox";
  displayName: string | null;
  handle: string | null;
  platformId: string;
  platformName: string;
  stage: LeadStage;
  score: number;
  summary: string | null;
  externalId: string;
  threadId: string | null;
  status: string;
  lastInboundAt: string;
  lastProcessedAt: string | null;
}

export interface CrmContactFilters {
  stage?: LeadStage;
  query?: string;
  limit?: number;
}

export interface CrmContactUpdateInput {
  contactId: string;
  stage?: LeadStage;
  score?: number;
  summary?: string | null;
}

export interface CrmCreateContactFromInboxInput {
  inboxMessageId: string;
  stage?: LeadStage;
  score?: number;
  summary?: string;
}

export interface CrmProviderStatus {
  name: CrmProviderName;
  label: string;
  active: boolean;
  connected: boolean;
  mode: "local" | "stub" | "live";
  details: Record<string, string | boolean | null>;
}

export type CrmActivityType = "note" | "task";
export type CrmActivityStatus = "logged" | "pending" | "completed";
export type CrmActivityPriority = "low" | "medium" | "high";

export interface CrmActivity {
  id: string;
  contactId: string;
  type: CrmActivityType;
  title: string | null;
  subject: string | null;
  body: string;
  status: CrmActivityStatus;
  priority: CrmActivityPriority | null;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
  syncedAt: string | null;
  externalId: string | null;
}

export interface CrmActivityFilters {
  contactId?: string;
  type?: CrmActivityType;
  status?: CrmActivityStatus;
  query?: string;
  limit?: number;
}

export interface CrmActivityCreateInput {
  contactId: string;
  type: CrmActivityType;
  title?: string;
  subject?: string;
  body: string;
  status?: CrmActivityStatus;
  priority?: CrmActivityPriority;
  dueAt?: string;
}

export interface CrmActivityUpdateInput {
  activityId: string;
  title?: string | null;
  subject?: string | null;
  body?: string;
  status?: CrmActivityStatus;
  priority?: CrmActivityPriority | null;
  dueAt?: string | null;
}

export interface CrmSyncResult {
  ok: boolean;
  provider: CrmProviderName;
  mode: "local" | "stub" | "live";
  contact: CrmContact;
  externalId?: string;
  message: string;
  preview?: Record<string, string | number | null>;
}

export interface CrmActivitySyncResult {
  ok: boolean;
  provider: CrmProviderName;
  mode: "local" | "stub" | "live";
  activity: CrmActivity;
  contact: CrmContact;
  externalId?: string;
  message: string;
  preview?: Record<string, string | number | null>;
}

export interface CrmContactStore {
  listContacts(filters?: CrmContactFilters): Promise<CrmContact[]>;
  getContact(contactId: string): Promise<CrmContact | null>;
  upsertContact(input: CrmContactUpdateInput): Promise<CrmContact>;
  createContactFromInbox(input: CrmCreateContactFromInboxInput): Promise<CrmContact>;
}

export interface CrmProvider {
  readonly name: CrmProviderName;
  getStatus(): Promise<CrmProviderStatus>;
  syncContact(contact: CrmContact): Promise<CrmSyncResult>;
  syncActivity(contact: CrmContact, activity: CrmActivity): Promise<CrmActivitySyncResult>;
}