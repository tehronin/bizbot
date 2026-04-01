import { db } from "@/lib/db";
import { getSecretValue } from "@/lib/runtime-secrets";
import {
  updateCrmActivitySync,
} from "@/lib/crm/activities";
import type {
  CrmActivity,
  CrmActivitySyncResult,
  CrmContact,
  CrmProvider,
  CrmProviderStatus,
  CrmSyncResult,
} from "@/lib/crm/types";

const HUBSPOT_CONTACT_MAP_PREFIX = "crm_hubspot_contact_map:";
const HUBSPOT_NOTE_ASSOCIATION_TYPE_ID = 202;
const HUBSPOT_TASK_ASSOCIATION_TYPE_ID = 204;

interface HubSpotContactRecord {
  id: string;
  properties?: Record<string, string | null | undefined>;
  createdAt?: string;
  updatedAt?: string;
  archived?: boolean;
}

interface HubSpotSearchResponse {
  total?: number;
  results?: HubSpotContactRecord[];
}

type HubSpotContactResponse = HubSpotContactRecord;

interface HubSpotContactMapRecord {
  hubspotContactId: string;
  source: "created" | "matched";
  syncedAt: string;
}

interface HubSpotObjectCreateResponse {
  id: string;
  properties?: Record<string, string | null | undefined>;
}

function getHubSpotPortalId(): string | null {
  const value = process.env.HUBSPOT_PORTAL_ID?.trim();
  return value ? value : null;
}

async function getHubSpotToken(): Promise<string | null> {
  const value = (await getSecretValue("HUBSPOT_PRIVATE_APP_TOKEN"))?.trim();
  return value ? value : null;
}

function getHubSpotBaseUrl(): string {
  return process.env.HUBSPOT_BASE_URL?.trim() || "https://api.hubapi.com";
}

function getHubSpotMapKey(contactId: string): string {
  return `${HUBSPOT_CONTACT_MAP_PREFIX}${contactId}`;
}

async function getHubSpotMap(contactId: string): Promise<HubSpotContactMapRecord | null> {
  const record = await db.setting.findUnique({
    where: { key: getHubSpotMapKey(contactId) },
    select: { value: true },
  });

  if (!record) {
    return null;
  }

  try {
    const parsed = JSON.parse(record.value) as HubSpotContactMapRecord;
    if (parsed && typeof parsed.hubspotContactId === "string") {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

async function saveHubSpotMap(contactId: string, value: HubSpotContactMapRecord): Promise<void> {
  await db.setting.upsert({
    where: { key: getHubSpotMapKey(contactId) },
    update: { value: JSON.stringify(value) },
    create: { key: getHubSpotMapKey(contactId), value: JSON.stringify(value) },
  });
}

function splitDisplayName(displayName: string | null): { firstName?: string; lastName?: string } {
  const normalized = displayName?.trim();
  if (!normalized) {
    return {};
  }

  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return {};
  }
  if (parts.length === 1) {
    return { firstName: parts[0] };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

function mapStageToLifecycleStage(contact: CrmContact): string | undefined {
  switch (contact.stage) {
    case "LEAD":
      return "lead";
    case "QUALIFIED":
    case "CONTACTED":
      return "salesqualifiedlead";
    case "CONVERTED":
      return "customer";
    case "LOST":
      return "other";
    case "NONE":
      return undefined;
  }
}

function buildHubSpotProperties(contact: CrmContact): Record<string, string> {
  const { firstName, lastName } = splitDisplayName(contact.displayName);
  const lifecycleStage = mapStageToLifecycleStage(contact);
  const properties: Record<string, string> = {};

  const fallbackFirstName = contact.handle?.replace(/^@/, "").trim() || "BizBot Contact";

  if (firstName || fallbackFirstName) {
    properties.firstname = firstName ?? fallbackFirstName;
  }
  if (lastName) {
    properties.lastname = lastName;
  }
  if (lifecycleStage) {
    properties.lifecyclestage = lifecycleStage;
  }

  return properties;
}

function buildHubSpotPreview(contact: CrmContact): Record<string, string | number | null> {
  const properties = buildHubSpotProperties(contact);
  return {
    firstname: properties.firstname ?? null,
    lastname: properties.lastname ?? null,
    lifecyclestage: properties.lifecyclestage ?? null,
    social_handle: contact.handle,
    social_platform: contact.platformName,
    bizbot_score: contact.score,
    bizbot_summary: contact.summary,
    bizbot_inbox_message_id: contact.id,
  };
}

function mapActivityPriority(priority: CrmActivity["priority"]): string | undefined {
  switch (priority) {
    case "high":
      return "HIGH";
    case "low":
      return "LOW";
    case "medium":
      return "MEDIUM";
    default:
      return undefined;
  }
}

function buildHubSpotActivityPreview(activity: CrmActivity): Record<string, string | number | null> {
  return {
    type: activity.type,
    subject: activity.subject,
    title: activity.title,
    body: activity.body,
    status: activity.status,
    priority: activity.priority,
    dueAt: activity.dueAt,
  };
}

async function createHubSpotActivity(
  contactId: string,
  activity: CrmActivity,
): Promise<HubSpotObjectCreateResponse> {
  if (activity.type === "note") {
    return callHubSpot<HubSpotObjectCreateResponse>("/crm/v3/objects/notes", {
      method: "POST",
      body: JSON.stringify({
        properties: {
          hs_timestamp: activity.createdAt,
          hs_note_body: activity.body,
        },
        associations: [
          {
            to: { id: contactId },
            types: [
              {
                associationCategory: "HUBSPOT_DEFINED",
                associationTypeId: HUBSPOT_NOTE_ASSOCIATION_TYPE_ID,
              },
            ],
          },
        ],
      }),
    });
  }

  return callHubSpot<HubSpotObjectCreateResponse>("/crm/v3/objects/tasks", {
    method: "POST",
    body: JSON.stringify({
      properties: {
        hs_timestamp: activity.dueAt ?? activity.createdAt,
        hs_task_subject: activity.subject ?? activity.title ?? "BizBot follow-up",
        hs_task_body: activity.body,
        hs_task_status: activity.status === "completed" ? "COMPLETED" : "NOT_STARTED",
        hs_task_priority: mapActivityPriority(activity.priority) ?? "MEDIUM",
        hs_task_type: "TODO",
      },
      associations: [
        {
          to: { id: contactId },
          types: [
            {
              associationCategory: "HUBSPOT_DEFINED",
              associationTypeId: HUBSPOT_TASK_ASSOCIATION_TYPE_ID,
            },
          ],
        },
      ],
    }),
  });
}

async function callHubSpot<T>(
  endpoint: string,
  init?: RequestInit,
): Promise<T> {
  const token = await getHubSpotToken();
  if (!token) {
    throw new Error("HubSpot private app token is not configured.");
  }

  const response = await fetch(`${getHubSpotBaseUrl()}${endpoint}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HubSpot API ${response.status}: ${text}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return await response.json() as T;
}

async function getMappedHubSpotContact(contactId: string): Promise<HubSpotContactRecord | null> {
  const mapping = await getHubSpotMap(contactId);
  if (!mapping) {
    return null;
  }

  try {
    return await callHubSpot<HubSpotContactResponse>(`/crm/v3/objects/contacts/${mapping.hubspotContactId}?properties=firstname,lastname,lifecyclestage`);
  } catch {
    return null;
  }
}

async function searchHubSpotContacts(contact: CrmContact): Promise<HubSpotContactRecord[]> {
  const { firstName, lastName } = splitDisplayName(contact.displayName);

  if (firstName && lastName) {
    const response = await callHubSpot<HubSpotSearchResponse>("/crm/v3/objects/contacts/search", {
      method: "POST",
      body: JSON.stringify({
        limit: 5,
        properties: ["firstname", "lastname", "lifecyclestage"],
        filterGroups: [
          {
            filters: [
              { propertyName: "firstname", operator: "EQ", value: firstName },
              { propertyName: "lastname", operator: "EQ", value: lastName },
            ],
          },
        ],
      }),
    });

    if ((response.results?.length ?? 0) > 0) {
      return response.results ?? [];
    }
  }

  const query = contact.displayName?.trim() || contact.handle?.trim();
  if (!query) {
    return [];
  }

  const response = await callHubSpot<HubSpotSearchResponse>("/crm/v3/objects/contacts/search", {
    method: "POST",
    body: JSON.stringify({
      limit: 5,
      query,
      properties: ["firstname", "lastname", "lifecyclestage"],
    }),
  });

  return response.results ?? [];
}

function pickBestHubSpotMatch(contact: CrmContact, candidates: HubSpotContactRecord[]): HubSpotContactRecord | null {
  if (candidates.length === 0) {
    return null;
  }

  const normalizedDisplayName = contact.displayName?.trim().toLowerCase();
  if (normalizedDisplayName) {
    const exact = candidates.find((candidate) => {
      const fullName = `${candidate.properties?.firstname ?? ""} ${candidate.properties?.lastname ?? ""}`.trim().toLowerCase();
      return fullName === normalizedDisplayName;
    });
    if (exact) {
      return exact;
    }
  }

  return candidates[0] ?? null;
}

async function createHubSpotContact(contact: CrmContact): Promise<HubSpotContactRecord> {
  return callHubSpot<HubSpotContactResponse>("/crm/v3/objects/contacts", {
    method: "POST",
    body: JSON.stringify({
      properties: buildHubSpotProperties(contact),
    }),
  });
}

async function updateHubSpotContact(hubspotContactId: string, contact: CrmContact): Promise<HubSpotContactRecord> {
  return callHubSpot<HubSpotContactResponse>(`/crm/v3/objects/contacts/${hubspotContactId}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: buildHubSpotProperties(contact),
    }),
  });
}

export class HubSpotCrmProvider implements CrmProvider {
  readonly name = "hubspot" as const;

  async getStatus(): Promise<CrmProviderStatus> {
    const token = await getHubSpotToken();
    const portalId = getHubSpotPortalId();
    const mappedContacts = await db.setting.count({
      where: { key: { startsWith: HUBSPOT_CONTACT_MAP_PREFIX } },
    });

    return {
      name: this.name,
      label: "HubSpot",
      active: (process.env.CRM_PROVIDER ?? "internal") === this.name,
      connected: Boolean(token),
      mode: token ? "live" : "stub",
      details: {
        portalId,
        tokenConfigured: Boolean(token),
        baseUrl: getHubSpotBaseUrl(),
        liveApiImplemented: true,
        mappedContacts: String(mappedContacts),
      },
    };
  }

  async syncContact(contact: CrmContact): Promise<CrmSyncResult> {
    const token = await getHubSpotToken();
    if (!token) {
      return {
        ok: true,
        provider: this.name,
        mode: "stub",
        contact,
        externalId: `hubspot-stub-${contact.id}`,
        message: "HubSpot token is not configured. Returning a sync preview without making an outbound API request.",
        preview: buildHubSpotPreview(contact),
      };
    }

    const now = new Date().toISOString();
    let syncAction: "updated" | "matched" | "created" = "created";
    let hubspotContact = await getMappedHubSpotContact(contact.id);

    if (hubspotContact) {
      syncAction = "updated";
      hubspotContact = await updateHubSpotContact(hubspotContact.id, contact);
    } else {
      const matches = await searchHubSpotContacts(contact);
      const match = pickBestHubSpotMatch(contact, matches);

      if (match) {
        syncAction = "matched";
        hubspotContact = await updateHubSpotContact(match.id, contact);
      } else {
        hubspotContact = await createHubSpotContact(contact);
      }
    }

    await saveHubSpotMap(contact.id, {
      hubspotContactId: hubspotContact.id,
      source: syncAction === "created" ? "created" : "matched",
      syncedAt: now,
    });

    return {
      ok: true,
      provider: this.name,
      mode: "live",
      contact,
      externalId: hubspotContact.id,
      message:
        syncAction === "updated"
          ? "Updated existing HubSpot contact using the saved BizBot-to-HubSpot mapping."
          : syncAction === "matched"
            ? "Matched an existing HubSpot contact and updated it, then saved the mapping locally."
            : "Created a new HubSpot contact and saved the mapping locally.",
      preview: buildHubSpotPreview(contact),
    };
  }

  async syncActivity(contact: CrmContact, activity: CrmActivity): Promise<CrmActivitySyncResult> {
    const token = await getHubSpotToken();
    if (!token) {
      return {
        ok: true,
        provider: this.name,
        mode: "stub",
        activity,
        contact,
        externalId: `hubspot-${activity.type}-stub-${activity.id}`,
        message: "HubSpot token is not configured. Returning an activity sync preview without making an outbound API request.",
        preview: buildHubSpotActivityPreview(activity),
      };
    }

    const contactSync = await this.syncContact(contact);
    if (!contactSync.externalId) {
      throw new Error(`HubSpot contact sync did not return an external id for contact ${contact.id}.`);
    }

    const created = await createHubSpotActivity(contactSync.externalId, activity);
    const syncedAt = new Date().toISOString();
    const syncedActivity = await updateCrmActivitySync(activity.id, {
      externalId: created.id,
      syncedAt,
    });

    return {
      ok: true,
      provider: this.name,
      mode: "live",
      activity: syncedActivity,
      contact,
      externalId: created.id,
      message: `Created a HubSpot ${activity.type} and associated it with the synced contact.`,
      preview: buildHubSpotActivityPreview(syncedActivity),
    };
  }
}