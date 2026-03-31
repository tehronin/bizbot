export const MEMORY_FACT_CATEGORIES = [
  "identity",
  "preference",
  "workflow",
  "constraint",
  "operator_setting",
  "other",
] as const;

export const MEMORY_FACT_SOURCES = ["user", "system", "admin"] as const;

export type MemoryFactCategory = (typeof MEMORY_FACT_CATEGORIES)[number];
export type MemoryFactSource = (typeof MEMORY_FACT_SOURCES)[number];

export const MEMORY_FACT_CATEGORY_LABELS: Record<MemoryFactCategory, string> = {
  identity: "identity",
  preference: "preference",
  workflow: "workflow",
  constraint: "constraint",
  operator_setting: "operator setting",
  other: "other",
};

export const MEMORY_FACT_SOURCE_LABELS: Record<MemoryFactSource, string> = {
  user: "user",
  system: "system",
  admin: "admin",
};