import type { AgentProfile } from "@/lib/agent/profiles";
import { getEnabledBuiltinPlugins, createPluginRegistry } from "@/lib/agent/plugins/registry";
import { getMcpClientTools } from "@/lib/mcp/client";

export type ChatExecutionMode = "ask" | "agent";

export interface ChatMessageKnowledgeAttachment {
  type: "knowledge-doc";
  path: string;
  label: string;
}

export type ChatMessageAttachment = ChatMessageKnowledgeAttachment;

export interface ChatExecutionPluginSummary {
  id: string;
  displayName: string;
  description: string;
  accentColor: string;
  accentSurface: string;
  accentBorder: string;
  toollessInAsk: boolean;
  toollessInAgent: boolean;
}

export interface ChatExecutionCatalog {
  defaults: {
    mode: ChatExecutionMode;
    pluginId: string;
  };
  plugins: ChatExecutionPluginSummary[];
}

export interface ChatExecutionSelection {
  mode: ChatExecutionMode;
  pluginId: string;
}

interface ChatExecutionPluginPolicy extends ChatExecutionPluginSummary {
  preferredProfile: AgentProfile;
  ownerPluginIds: string[];
}

export const DEFAULT_CHAT_EXECUTION_MODE: ChatExecutionMode = "ask";
export const DEFAULT_CHAT_EXECUTION_PLUGIN_ID = "just-chatting";

const CHAT_PLUGIN_POLICIES: ChatExecutionPluginPolicy[] = [
  {
    id: DEFAULT_CHAT_EXECUTION_PLUGIN_ID,
    displayName: "Just Chatting",
    description: "Full-context chat and planning without tool execution.",
    accentColor: "#38bdf8",
    accentSurface: "rgba(56,189,248,0.12)",
    accentBorder: "rgba(56,189,248,0.36)",
    toollessInAsk: true,
    toollessInAgent: true,
    preferredProfile: "general_operator",
    ownerPluginIds: [],
  },
  {
    id: "content",
    displayName: "Content",
    description: "Drafting, refinement, and content policy workflows.",
    accentColor: "#fb7185",
    accentSurface: "rgba(251,113,133,0.12)",
    accentBorder: "rgba(251,113,133,0.34)",
    toollessInAsk: true,
    toollessInAgent: false,
    preferredProfile: "content_operator",
    ownerPluginIds: ["content"],
  },
  {
    id: "social",
    displayName: "Social",
    description: "Publishing, replies, and social platform actions.",
    accentColor: "#22c55e",
    accentSurface: "rgba(34,197,94,0.12)",
    accentBorder: "rgba(34,197,94,0.32)",
    toollessInAsk: true,
    toollessInAgent: false,
    preferredProfile: "content_operator",
    ownerPluginIds: ["social"],
  },
  {
    id: "crm",
    displayName: "CRM",
    description: "Contacts, activities, and conversion workflows.",
    accentColor: "#f97316",
    accentSurface: "rgba(249,115,22,0.12)",
    accentBorder: "rgba(249,115,22,0.34)",
    toollessInAsk: true,
    toollessInAgent: false,
    preferredProfile: "sales_operator",
    ownerPluginIds: ["crm"],
  },
  {
    id: "commerce",
    displayName: "Commerce",
    description: "Products, orders, and local sales workflows.",
    accentColor: "#f59e0b",
    accentSurface: "rgba(245,158,11,0.12)",
    accentBorder: "rgba(245,158,11,0.34)",
    toollessInAsk: true,
    toollessInAgent: false,
    preferredProfile: "sales_operator",
    ownerPluginIds: ["commerce"],
  },
  {
    id: "builder",
    displayName: "Builder",
    description: "External workspace scaffolding and build-lane operations.",
    accentColor: "#a78bfa",
    accentSurface: "rgba(167,139,250,0.12)",
    accentBorder: "rgba(167,139,250,0.34)",
    toollessInAsk: true,
    toollessInAgent: false,
    preferredProfile: "builder_operator",
    ownerPluginIds: ["builder"],
  },
  {
    id: "creeper",
    displayName: "Creeper",
    description: "Read-only company data source setup, profiling, and evidence-grounded investigation.",
    accentColor: "#0f766e",
    accentSurface: "rgba(15,118,110,0.14)",
    accentBorder: "rgba(15,118,110,0.34)",
    toollessInAsk: true,
    toollessInAgent: false,
    preferredProfile: "analyst_operator",
    ownerPluginIds: ["creeper"],
  },
  {
    id: "local-business",
    displayName: "Local Business",
    description: "Reviews, listings, and reputation-facing local operations.",
    accentColor: "#14b8a6",
    accentSurface: "rgba(20,184,166,0.12)",
    accentBorder: "rgba(20,184,166,0.32)",
    toollessInAsk: true,
    toollessInAgent: false,
    preferredProfile: "reputation_operator",
    ownerPluginIds: ["local-business"],
  },
  {
    id: "browser",
    displayName: "Browser",
    description: "Grounded web research and browsing.",
    accentColor: "#2dd4bf",
    accentSurface: "rgba(45,212,191,0.12)",
    accentBorder: "rgba(45,212,191,0.32)",
    toollessInAsk: true,
    toollessInAgent: false,
    preferredProfile: "research_operator",
    ownerPluginIds: ["browser"],
  },
  {
    id: "oracle",
    displayName: "Oracle",
    description: "Market-focused prediction and evidence gathering.",
    accentColor: "#facc15",
    accentSurface: "rgba(250,204,21,0.14)",
    accentBorder: "rgba(250,204,21,0.36)",
    toollessInAsk: true,
    toollessInAgent: false,
    preferredProfile: "research_operator",
    ownerPluginIds: ["oracle"],
  },
];

function isChatExecutionMode(value: unknown): value is ChatExecutionMode {
  return value === "ask" || value === "agent";
}

function listEnabledChatPluginPolicies(): ChatExecutionPluginPolicy[] {
  const enabledPluginIds = new Set(getEnabledBuiltinPlugins().map((plugin) => plugin.metadata.id));
  return CHAT_PLUGIN_POLICIES.filter((policy) => (
    policy.id === DEFAULT_CHAT_EXECUTION_PLUGIN_ID
      || policy.ownerPluginIds.every((ownerPluginId) => enabledPluginIds.has(ownerPluginId))
  ));
}

export function buildChatExecutionCatalog(): ChatExecutionCatalog {
  const plugins = listEnabledChatPluginPolicies().map((policy) => ({
    id: policy.id,
    displayName: policy.displayName,
    description: policy.description,
    accentColor: policy.accentColor,
    accentSurface: policy.accentSurface,
    accentBorder: policy.accentBorder,
    toollessInAsk: policy.toollessInAsk,
    toollessInAgent: policy.toollessInAgent,
  }));

  return {
    defaults: {
      mode: DEFAULT_CHAT_EXECUTION_MODE,
      pluginId: DEFAULT_CHAT_EXECUTION_PLUGIN_ID,
    },
    plugins,
  };
}

export function resolveChatExecutionSelection(input?: Partial<ChatExecutionSelection> | null): ChatExecutionSelection {
  const catalog = buildChatExecutionCatalog();
  const requestedPluginId = typeof input?.pluginId === "string" ? input.pluginId.trim() : "";
  const pluginId = catalog.plugins.some((plugin) => plugin.id === requestedPluginId)
    ? requestedPluginId
    : catalog.defaults.pluginId;

  return {
    mode: isChatExecutionMode(input?.mode) ? input.mode : catalog.defaults.mode,
    pluginId,
  };
}

export function normalizeChatMessageAttachments(value: unknown): ChatMessageAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }

    const candidate = entry as Record<string, unknown>;
    if (candidate.type !== "knowledge-doc") {
      return [];
    }

    const path = typeof candidate.path === "string" ? candidate.path.trim() : "";
    const label = typeof candidate.label === "string" ? candidate.label.trim() : "";
    if (!path || !label) {
      return [];
    }

    return [{
      type: "knowledge-doc" as const,
      path,
      label,
    }];
  });
}

export function getChatExecutionPluginSummary(pluginId: string): ChatExecutionPluginSummary {
  const catalog = buildChatExecutionCatalog();
  return catalog.plugins.find((plugin) => plugin.id === pluginId)
    ?? catalog.plugins.find((plugin) => plugin.id === catalog.defaults.pluginId)
    ?? {
      id: DEFAULT_CHAT_EXECUTION_PLUGIN_ID,
      displayName: "Just Chatting",
      description: "Full-context chat and planning without tool execution.",
      accentColor: "#38bdf8",
      accentSurface: "rgba(56,189,248,0.12)",
      accentBorder: "rgba(56,189,248,0.36)",
      toollessInAsk: true,
      toollessInAgent: true,
    };
}

export function getChatExecutionProfile(selection: ChatExecutionSelection): AgentProfile {
  const resolved = resolveChatExecutionSelection(selection);
  const policy = listEnabledChatPluginPolicies().find((entry) => entry.id === resolved.pluginId);
  return policy?.preferredProfile ?? "general_operator";
}

export function isOracleChatExecutionSelection(selection: ChatExecutionSelection): boolean {
  const resolved = resolveChatExecutionSelection(selection);
  return resolved.pluginId === "oracle";
}

export function resolveChatExecutionToolNames(selection: ChatExecutionSelection): string[] {
  const resolved = resolveChatExecutionSelection(selection);
  const policy = listEnabledChatPluginPolicies().find((entry) => entry.id === resolved.pluginId);

  if (!policy) {
    return [];
  }

  if ((resolved.mode === "ask" && policy.toollessInAsk) || (resolved.mode === "agent" && policy.toollessInAgent)) {
    return [];
  }

  const registry = createPluginRegistry(getEnabledBuiltinPlugins(), getMcpClientTools());
  return registry.tools
    .filter((tool) => {
      const ownerPluginId = registry.toolToPluginId.get(tool.name);
      return ownerPluginId ? policy.ownerPluginIds.includes(ownerPluginId) : false;
    })
    .map((tool) => tool.name)
    .sort((left, right) => left.localeCompare(right));
}