export type AgentAutonomyPreset = "manual_only" | "reply_only" | "approval_all_posts" | "wide_open";

export interface AgentRuntimeConfig {
  autonomyPreset: AgentAutonomyPreset;
  heartbeatSeconds: number;
  knowledgePath: string;
  knowledgeEnabled: boolean;
}

export interface AgentCapabilities {
  canCreatePosts: boolean;
  canReplyDirectly: boolean;
  canPublishWithoutApproval: boolean;
  usesKnowledgeFolder: boolean;
  replyScope: "none" | "direct_messages_only" | "all_inbound";
}

const DEFAULT_HEARTBEAT_SECONDS = 300;

function parsePositiveInteger(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.trunc(parsed);
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parseAutonomyPreset(raw: string | undefined): AgentAutonomyPreset {
  switch (raw) {
    case "manual_only":
    case "reply_only":
    case "approval_all_posts":
    case "wide_open":
      return raw;
    default:
      return "approval_all_posts";
  }
}

export function getAgentRuntimeConfig(): AgentRuntimeConfig {
  return {
    autonomyPreset: parseAutonomyPreset(process.env.BIZBOT_AUTONOMY_PRESET),
    heartbeatSeconds: Math.max(15, parsePositiveInteger(process.env.BIZBOT_AGENT_HEARTBEAT_SECONDS, DEFAULT_HEARTBEAT_SECONDS)),
    knowledgePath: process.env.BIZBOT_KNOWLEDGE_PATH ?? "knowledge",
    knowledgeEnabled: parseBoolean(process.env.BIZBOT_KNOWLEDGE_ENABLED, true),
  };
}

export function getAgentCapabilities(config: AgentRuntimeConfig = getAgentRuntimeConfig()): AgentCapabilities {
  switch (config.autonomyPreset) {
    case "manual_only":
      return {
        canCreatePosts: false,
        canReplyDirectly: false,
        canPublishWithoutApproval: false,
        usesKnowledgeFolder: config.knowledgeEnabled,
        replyScope: "none",
      };
    case "reply_only":
      return {
        canCreatePosts: false,
        canReplyDirectly: true,
        canPublishWithoutApproval: true,
        usesKnowledgeFolder: config.knowledgeEnabled,
        replyScope: "direct_messages_only",
      };
    case "approval_all_posts":
      return {
        canCreatePosts: true,
        canReplyDirectly: true,
        canPublishWithoutApproval: false,
        usesKnowledgeFolder: config.knowledgeEnabled,
        replyScope: "all_inbound",
      };
    case "wide_open":
      return {
        canCreatePosts: true,
        canReplyDirectly: true,
        canPublishWithoutApproval: true,
        usesKnowledgeFolder: config.knowledgeEnabled,
        replyScope: "all_inbound",
      };
  }
}

export function getAutonomyDescription(config: AgentRuntimeConfig = getAgentRuntimeConfig()): string {
  switch (config.autonomyPreset) {
    case "manual_only":
      return "Research and drafting only. No direct social publishing or replies.";
    case "reply_only":
      return "The agent may answer direct-message inbox items automatically, but it cannot originate new posts or auto-reply publicly.";
    case "approval_all_posts":
      return "The agent may draft new posts, but top-level publishing must go through the approval queue.";
    case "wide_open":
      return "The agent may publish and reply without a human approval gate.";
  }
}

export function buildAutonomySystemPrompt(config: AgentRuntimeConfig = getAgentRuntimeConfig()): string {
  const capabilities = getAgentCapabilities(config);

  return [
    `Autonomy preset: ${config.autonomyPreset}. ${getAutonomyDescription(config)}`,
    `Heartbeat: ${config.heartbeatSeconds} seconds.`,
    capabilities.usesKnowledgeFolder
      ? `Knowledge folder retrieval is enabled from workspace/${config.knowledgePath}.`
      : "Knowledge folder retrieval is disabled.",
    capabilities.canCreatePosts
      ? capabilities.canPublishWithoutApproval
        ? "The agent may create and publish posts directly when needed."
        : "The agent may draft posts, but must respect approval requirements before publishing."
      : "The agent must not originate new top-level social posts.",
    capabilities.canReplyDirectly
      ? capabilities.replyScope === "direct_messages_only"
        ? "The agent may reply directly only to direct-message inbox items."
        : "The agent may reply directly when context supports it."
      : "The agent must not send social replies directly.",
  ].join(" ");
}