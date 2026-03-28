import crypto from "node:crypto";
import { db } from "@/lib/db";
import type {
  CrmActivity,
  CrmActivityCreateInput,
  CrmActivityFilters,
  CrmActivityUpdateInput,
} from "@/lib/crm/types";

const CRM_ACTIVITY_KEY_PREFIX = "crm_activity:";

function getActivityKey(activityId: string): string {
  return `${CRM_ACTIVITY_KEY_PREFIX}${activityId}`;
}

function isCrmActivity(value: unknown): value is CrmActivity {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<CrmActivity>;
  return typeof candidate.id === "string"
    && typeof candidate.contactId === "string"
    && (candidate.type === "note" || candidate.type === "task")
    && typeof candidate.createdAt === "string"
    && typeof candidate.updatedAt === "string";
}

function matchesFilters(activity: CrmActivity, filters: CrmActivityFilters): boolean {
  if (filters.contactId && activity.contactId !== filters.contactId) {
    return false;
  }
  if (filters.type && activity.type !== filters.type) {
    return false;
  }
  if (filters.status && activity.status !== filters.status) {
    return false;
  }

  const query = filters.query?.trim().toLowerCase();
  if (!query) {
    return true;
  }

  return [activity.subject, activity.body, activity.title]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(query));
}

export async function listCrmActivities(filters: CrmActivityFilters = {}): Promise<CrmActivity[]> {
  const limit = Math.min(Math.max(filters.limit ?? 25, 1), 100);
  const records = await db.setting.findMany({
    where: { key: { startsWith: CRM_ACTIVITY_KEY_PREFIX } },
    orderBy: { updatedAt: "desc" },
    take: Math.max(limit * 3, limit),
  });

  return records
    .flatMap((record) => {
      try {
        const parsed = JSON.parse(record.value) as unknown;
        return isCrmActivity(parsed) ? [parsed] : [];
      } catch {
        return [];
      }
    })
    .filter((activity) => matchesFilters(activity, filters))
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, limit);
}

export async function getCrmActivity(activityId: string): Promise<CrmActivity | null> {
  const record = await db.setting.findUnique({
    where: { key: getActivityKey(activityId) },
    select: { value: true },
  });

  if (!record) {
    return null;
  }

  try {
    const parsed = JSON.parse(record.value) as unknown;
    return isCrmActivity(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function createCrmActivity(input: CrmActivityCreateInput): Promise<CrmActivity> {
  const contactExists = await db.inboxMessage.findUnique({
    where: { id: input.contactId },
    select: { id: true },
  });
  if (!contactExists) {
    throw new Error(`CRM contact not found: ${input.contactId}`);
  }

  const now = new Date().toISOString();
  const activity: CrmActivity = {
    id: crypto.randomUUID(),
    contactId: input.contactId,
    type: input.type,
    title: input.title ?? null,
    subject: input.subject ?? null,
    body: input.body,
    status: input.type === "task" ? input.status ?? "pending" : "logged",
    priority: input.type === "task" ? input.priority ?? "medium" : null,
    dueAt: input.type === "task" ? input.dueAt ?? null : null,
    createdAt: now,
    updatedAt: now,
    syncedAt: null,
    externalId: null,
  };

  await db.setting.upsert({
    where: { key: getActivityKey(activity.id) },
    update: { value: JSON.stringify(activity) },
    create: { key: getActivityKey(activity.id), value: JSON.stringify(activity) },
  });

  return activity;
}

export async function updateCrmActivitySync(
  activityId: string,
  params: { externalId?: string; syncedAt?: string },
): Promise<CrmActivity> {
  const activity = await getCrmActivity(activityId);
  if (!activity) {
    throw new Error(`CRM activity not found: ${activityId}`);
  }

  const next: CrmActivity = {
    ...activity,
    ...(params.externalId !== undefined ? { externalId: params.externalId } : {}),
    ...(params.syncedAt !== undefined ? { syncedAt: params.syncedAt } : {}),
    updatedAt: new Date().toISOString(),
  };

  await db.setting.update({
    where: { key: getActivityKey(activity.id) },
    data: { value: JSON.stringify(next) },
  });

  return next;
}

export async function updateCrmActivity(input: CrmActivityUpdateInput): Promise<CrmActivity> {
  const activity = await getCrmActivity(input.activityId);
  if (!activity) {
    throw new Error(`CRM activity not found: ${input.activityId}`);
  }

  const next: CrmActivity = {
    ...activity,
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.subject !== undefined ? { subject: input.subject } : {}),
    ...(input.body !== undefined ? { body: input.body } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.priority !== undefined ? { priority: input.priority } : {}),
    ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
    updatedAt: new Date().toISOString(),
  };

  await db.setting.update({
    where: { key: getActivityKey(activity.id) },
    data: { value: JSON.stringify(next) },
  });

  return next;
}