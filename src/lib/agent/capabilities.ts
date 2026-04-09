import type { ToolDescriptor } from "@/lib/agent/tools";
import type { AgentProfile } from "@/lib/agent/profiles";

const SELF_DESCRIPTION_PATTERNS = [
  /\bwhat can you do\b/i,
  /\bwhat do you do\b/i,
  /\bwho are you\b/i,
  /\bintroduce yourself\b/i,
  /\bcore features?\b/i,
  /\bmajor features?\b/i,
  /\bwhat about builder\b/i,
  /\bbuilder\b.*\bmajor feature\b/i,
  /\bbuilder\b.*\bcore feature\b/i,
  /\btell me about .*builder\b/i,
];

const TOOL_VISIBILITY_PATTERNS = [
  /\bwhat plugins?\b/i,
  /\bwhat plugins do you have\b/i,
  /\bwhat tools?\b/i,
  /\bwhat tools do you have\b/i,
  /\bwhat tools are available\b/i,
  /\bwhat can you access right now\b/i,
  /\bwhat can you see right now\b/i,
  /\bwhat is available in this lane\b/i,
  /\bwhich plugins\b/i,
  /\bwhich tools\b/i,
];

const TOOL_FAMILY_LABELS: Record<string, string> = {
  agent: "agent orchestration",
  approval: "approval queue",
  browser: "browser automation",
  builder: "builder workspace",
  commerce: "commerce",
  competitor: "competitor monitoring",
  content: "content operations",
  crm: "crm",
  developer: "developer inspection",
  file: "file operations",
  graph: "knowledge graph",
  local_business: "local business",
  memory: "memory",
  oracle: "oracle",
  schedule: "scheduling",
  sidecar: "sidecar",
  social: "social",
};

const BIZBOT_CAPABILITY_SUMMARY_LINES = [
  "[BizBot Capabilities]",
  "BizBot is a local-first agent platform, not only a social media assistant.",
  "- Agent chat and specialist routing across general, content, sales, research, analytics, platform, and builder lanes.",
  "- Builder Mode for dedicated external-workspace project creation, planning, task orchestration, runtime inspection, environment management, and safe file or command operations.",
  "- Social, approval, and reputation workflows for drafting, scheduling, queueing, reviewing, and publishing posts with human approval before top-level publish actions.",
  "- Inbox, CRM, commerce, and local-business operations for leads, contacts, activities, products, orders, reviews, posts, and provider readiness.",
  "- Memory, ontology, and knowledge retrieval for stable user facts, business context, and bounded prompt augmentation.",
  "- Plugin, MCP, analytics, and operations surfaces for runtime inspection, tool exposure, usage tracking, and developer-safe extension workflows.",
  "When describing BizBot, present Builder as a first-class product surface alongside chat, operations, and business workflows.",
  "[/BizBot Capabilities]",
];

export function shouldInjectBizBotCapabilitySummary(message: string): boolean {
  return SELF_DESCRIPTION_PATTERNS.some((pattern) => pattern.test(message));
}

export function buildBizBotCapabilitySummary(): string {
  return BIZBOT_CAPABILITY_SUMMARY_LINES.join("\n");
}

export function shouldInjectRuntimeToolVisibilitySummary(message: string): boolean {
  return TOOL_VISIBILITY_PATTERNS.some((pattern) => pattern.test(message));
}

function getToolFamily(toolName: string): string {
  const parts = toolName.split("_");
  if (parts.length >= 2 && parts[0] === "local" && parts[1] === "business") {
    return "local_business";
  }
  return parts[0] ?? "other";
}

export function buildRuntimeToolVisibilitySummary(params: {
  profile: AgentProfile;
  tools: ToolDescriptor[];
  delegationTargets: AgentProfile[];
}): string {
  const familyMap = new Map<string, string[]>();
  for (const tool of params.tools) {
    const family = getToolFamily(tool.name);
    const existing = familyMap.get(family) ?? [];
    existing.push(tool.name);
    familyMap.set(family, existing);
  }

  const familyLines = Array.from(familyMap.entries())
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([family, toolNames]) => {
      const label = TOOL_FAMILY_LABELS[family] ?? family.replace(/_/g, " ");
      const samples = toolNames.slice(0, 4).join(", ");
      const remainder = toolNames.length > 4 ? `, +${toolNames.length - 4} more` : "";
      return `- ${label}: ${toolNames.length} visible tool${toolNames.length === 1 ? "" : "s"} (${samples}${remainder})`;
    });

  const delegatedBuilderLine = !familyMap.has("builder") && params.delegationTargets.includes("builder_operator")
    ? "- builder workspace: not directly visible in this lane; reachable through delegation to builder_operator"
    : null;

  return [
    "[Runtime Tool Visibility]",
    `Current lane: ${params.profile}. These are the tools directly visible to this lane right now.`,
    ...familyLines,
    ...(delegatedBuilderLine ? [delegatedBuilderLine] : []),
    "When answering plugin or tool questions, distinguish between directly visible tools and delegated specialist access.",
    "[/Runtime Tool Visibility]",
  ].join("\n");
}