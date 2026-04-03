export interface BuiltinPluginToggleDefinition {
  id: string;
  displayName: string;
  description: string;
  tags: string[];
  envKey: string;
  defaultEnabled: boolean;
}

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

export const BUILTIN_PLUGIN_TOGGLES: BuiltinPluginToggleDefinition[] = [
  {
    id: "social",
    displayName: "Social",
    description: "Social publishing, replies, mentions, and analytics.",
    tags: ["social", "publishing"],
    envKey: "BIZBOT_PLUGIN_SOCIAL_ENABLED",
    defaultEnabled: true,
  },
  {
    id: "commerce",
    displayName: "Commerce",
    description: "Local-first products and orders for sales workflows.",
    tags: ["commerce", "sales"],
    envKey: "BIZBOT_PLUGIN_COMMERCE_ENABLED",
    defaultEnabled: true,
  },
  {
    id: "content",
    displayName: "Content",
    description: "Content drafting, refinement, and policy checks.",
    tags: ["content", "drafting"],
    envKey: "BIZBOT_PLUGIN_CONTENT_ENABLED",
    defaultEnabled: true,
  },
  {
    id: "crm",
    displayName: "CRM",
    description: "CRM contacts, activities, and provider synchronization.",
    tags: ["crm", "sales"],
    envKey: "BIZBOT_PLUGIN_CRM_ENABLED",
    defaultEnabled: true,
  },
  {
    id: "builder",
    displayName: "Builder",
    description: "Sandboxed workspace scaffolding, file generation, and allowlisted command execution.",
    tags: ["builder", "workspace"],
    envKey: "BIZBOT_PLUGIN_BUILDER_ENABLED",
    defaultEnabled: true,
  },
  {
    id: "delegation",
    displayName: "Delegation",
    description: "Delegated sub-runs across specialist operator lanes.",
    tags: ["agent", "delegation"],
    envKey: "BIZBOT_PLUGIN_DELEGATION_ENABLED",
    defaultEnabled: true,
  },
  {
    id: "developer",
    displayName: "Developer",
    description: "Runtime inspection tools for workers, memories, and agent runs.",
    tags: ["developer", "debugging"],
    envKey: "BIZBOT_PLUGIN_DEVELOPER_ENABLED",
    defaultEnabled: true,
  },
  {
    id: "memory",
    displayName: "Memory",
    description: "Semantic recall plus explicit relational user memory tools.",
    tags: ["memory", "knowledge"],
    envKey: "BIZBOT_PLUGIN_MEMORY_ENABLED",
    defaultEnabled: true,
  },
  {
    id: "files",
    displayName: "Files",
    description: "Workspace file operations.",
    tags: ["files", "workspace"],
    envKey: "BIZBOT_PLUGIN_FILES_ENABLED",
    defaultEnabled: true,
  },
  {
    id: "graph",
    displayName: "Graph",
    description: "Knowledge graph search and context tools.",
    tags: ["graph", "knowledge"],
    envKey: "BIZBOT_PLUGIN_GRAPH_ENABLED",
    defaultEnabled: true,
  },
  {
    id: "local-business",
    displayName: "Local Business",
    description: "Google Business Profile reviews, posts, and hours.",
    tags: ["local-business", "reputation"],
    envKey: "BIZBOT_PLUGIN_LOCAL_BUSINESS_ENABLED",
    defaultEnabled: true,
  },
  {
    id: "schedule",
    displayName: "Schedule",
    description: "Publishing schedule management.",
    tags: ["schedule", "publishing"],
    envKey: "BIZBOT_PLUGIN_SCHEDULE_ENABLED",
    defaultEnabled: true,
  },
  {
    id: "approval",
    displayName: "Approval",
    description: "Approval queue workflows and decisions.",
    tags: ["approval", "governance"],
    envKey: "BIZBOT_PLUGIN_APPROVAL_ENABLED",
    defaultEnabled: true,
  },
  {
    id: "browser",
    displayName: "Browser",
    description: "Playwright-backed web browsing and extraction.",
    tags: ["browser", "research"],
    envKey: "BIZBOT_PLUGIN_BROWSER_ENABLED",
    defaultEnabled: true,
  },
  {
    id: "competitor",
    displayName: "Competitor",
    description: "Competitor watch configuration and checks.",
    tags: ["competitor", "research"],
    envKey: "BIZBOT_PLUGIN_COMPETITOR_ENABLED",
    defaultEnabled: true,
  },
  {
    id: "oracle",
    displayName: "Oracle",
    description: "Read-only Polymarket market search, verdicts, and Sidecar-powered selection flows.",
    tags: ["oracle", "markets", "research"],
    envKey: "BIZBOT_PLUGIN_ORACLE_ENABLED",
    defaultEnabled: false,
  },
  {
    id: "conversation-bridge",
    displayName: "Conversation Bridge",
    description: "Cross-system conversation inspection that bridges chat threads into ontology context, Builder project matches, and approval-queue review.",
    tags: ["conversation", "bridge", "power-user"],
    envKey: "BIZBOT_PLUGIN_CONVERSATION_BRIDGE_ENABLED",
    defaultEnabled: false,
  },
];

const BUILTIN_PLUGIN_TOGGLE_MAP = new Map(BUILTIN_PLUGIN_TOGGLES.map((plugin) => [plugin.id, plugin]));

export function isEnvFlagEnabled(value: string | undefined, defaultEnabled = false): boolean {
  if (typeof value !== "string" || value.trim().length === 0) {
    return defaultEnabled;
  }

  return TRUE_VALUES.has(value.trim().toLowerCase());
}

export function getBuiltinPluginToggle(id: string): BuiltinPluginToggleDefinition | null {
  return BUILTIN_PLUGIN_TOGGLE_MAP.get(id) ?? null;
}

export function isBuiltinPluginEnabled(id: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const plugin = getBuiltinPluginToggle(id);
  if (!plugin) {
    return true;
  }

  return isEnvFlagEnabled(env[plugin.envKey], plugin.defaultEnabled);
}

export function isConversationBridgeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (typeof env.BIZBOT_CONVERSATION_BRIDGE_ENABLED === "string" && env.BIZBOT_CONVERSATION_BRIDGE_ENABLED.trim().length > 0) {
    return isEnvFlagEnabled(env.BIZBOT_CONVERSATION_BRIDGE_ENABLED, false);
  }

  return isBuiltinPluginEnabled("conversation-bridge", env);
}