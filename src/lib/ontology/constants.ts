export const ONTOLOGY_SCOPES = ["user", "runtime", "global"] as const;
export const ONTOLOGY_SCOPE_PRECEDENCE = ["user", "runtime", "global"] as const;
export const ONTOLOGY_STATUSES = ["active", "inactive", "deprecated"] as const;
export const ONTOLOGY_ALIAS_KINDS = ["canonical", "display_name", "memory_key", "value"] as const;
export const ONTOLOGY_SOURCES = ["user_memory", "system", "bootstrap", "manual"] as const;
export const ONTOLOGY_EVIDENCE_SOURCE_KINDS = ["user_memory_fact", "system", "bootstrap", "manual"] as const;
export const ONTOLOGY_PROMOTION_ALLOWLIST = ["identity", "preference", "workflow", "constraint", "operator_setting", "goal"] as const;

export const ONTOLOGY_ENTITY_TYPES = [
  "user_profile",
  "identity",
  "preference",
  "workflow",
  "constraint",
  "operator_setting",
  "goal",
  "policy",
  "profile",
] as const;

export const ONTOLOGY_RELATION_TYPES = [
  "has_identity",
  "has_preference",
  "uses_workflow",
  "has_constraint",
  "configured_with",
  "pursues_goal",
] as const;

export const ONTOLOGY_PROMPT_MAX_LINES = 8;
export const ONTOLOGY_PROMPT_MAX_CHARS = 800;
export const ONTOLOGY_PROMPT_MAX_FACT_LINES = 6;
export const ONTOLOGY_PROMOTION_MAX_SERIALIZED_CHARS = 512;
export const ONTOLOGY_PROMOTION_MAX_OBJECT_KEYS = 6;

export const ONTOLOGY_RUNTIME_RELATION_PRIORITY: Record<string, number> = {
  has_identity: 0,
  has_preference: 1,
  has_constraint: 2,
  uses_workflow: 3,
  configured_with: 4,
  pursues_goal: 5,
};

export const ONTOLOGY_BOOTSTRAP_VOCABULARY = {
  maxBootstrapEntities: 25,
  entityTypes: [...ONTOLOGY_ENTITY_TYPES],
  relationTypes: [...ONTOLOGY_RELATION_TYPES],
  notes: [
    "Ontology v1 keeps bootstrap optional and intentionally small.",
    "Static vocabulary is preferred over dynamic registry-wide import.",
    "System and bootstrap records should be marked inactive or deprecated instead of hard-deleted automatically.",
  ],
};

export const ONTOLOGY_RUNTIME_CONTEXT_POLICY = {
  blockName: "Ontology Context",
  maxLines: ONTOLOGY_PROMPT_MAX_LINES,
  maxCharacters: ONTOLOGY_PROMPT_MAX_CHARS,
  include: [
    "canonical user reference",
    "concise preference summary",
    "concise constraint summary",
    "concise workflow summary",
    "short goal or relation hint when available",
  ],
  exclude: [
    "raw evidence",
    "raw aliases",
    "large JSON attributes",
    "developer diagnostics",
    "preview catalog data",
    "plugin inspection reports",
  ],
  notes: [
    "Runtime ontology reads must be optional and fail-soft.",
    "Runtime ontology writes must not block the hot path.",
    "Omit the block entirely when useful context cannot fit inside budget.",
  ],
};

export const ONTOLOGY_PROMOTION_RULE_SUMMARY = {
  allowlistedCategories: [...ONTOLOGY_PROMOTION_ALLOWLIST],
  requiredConditions: [
    "fact is active",
    "category is allowlisted",
    "value is structurally usable",
    "value is compact enough for deterministic handling",
    "value is durable and stable",
    "value is not secret-like, temporary, or speculative",
  ],
  mappings: {
    identity: "user entity gets a has_identity relation to a canonical identity entity; preferred-name style facts may also update the user display name",
    preference: "user entity gets a has_preference relation to a canonical preference entity",
    workflow: "user entity gets a uses_workflow relation to a canonical workflow entity",
    constraint: "user entity gets a has_constraint relation to a canonical constraint entity",
    operator_setting: "user entity gets a configured_with relation to a canonical operator-setting entity",
  },
  notes: [
    "Promotion is deterministic and does not use fuzzy extraction.",
    "Promotion records evidence back to UserMemoryFact provenance.",
    "Promotion stores compact canonical attributes instead of mirroring arbitrary JSON.",
  ],
};