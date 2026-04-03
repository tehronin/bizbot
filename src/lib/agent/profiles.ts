export type AgentProfile =
  | "general_operator"
  | "sales_operator"
  | "content_operator"
  | "reputation_operator"
  | "analyst_operator"
  | "research_operator"
  | "platform_operator"
  | "builder_operator"
  | "mcp_operator";

export interface AgentProfileDecision {
  profile: AgentProfile;
  reason: string;
}

export interface AgentToolPolicy {
  allowedPrefixes: string[];
  allowedTools?: string[];
  deniedTools?: string[];
}

export interface AgentProfileDescriptor {
  id: AgentProfile;
  label: string;
  mission: string;
  delegationTargets: AgentProfile[];
  toolPolicy: AgentToolPolicy;
  prompt: {
    systemInstruction: string;
    googleSearch: boolean;
    googleCodeExecution: boolean;
    forceToolUse: boolean;
  };
}

const PROFILE_RULES: Array<{
  profile: AgentProfile;
  reason: string;
  matchers: RegExp[];
}> = [
  {
    profile: "builder_operator",
    reason: "message appears to be about scaffolding, code generation, or building inside an external workspace",
    matchers: [
      /builder mode/i,
      /openclaw/i,
      /\bscaffold\b/i,
      /\bcodegen\b/i,
      /generate (?:a )?(?:project|app|plugin)/i,
      /build (?:me|an?|out) /i,
    ],
  },
  {
    profile: "platform_operator",
    reason: "message appears to be about runtime, tools, MCP, workers, logs, or debugging",
    matchers: [
      /\bdebug\b/i,
      /\berror\b/i,
      /\bbug\b/i,
      /\bmcp\b/i,
      /\bworker\b/i,
      /\bheartbeat\b/i,
      /\bqueue\b/i,
      /\blogs?\b/i,
      /\btrace\b/i,
      /\bruntime\b/i,
      /\btools?\b/i,
    ],
  },
  {
    profile: "sales_operator",
    reason: "message appears to be about leads, contacts, CRM, qualification, or conversion",
    matchers: [
      /\bcrm\b/i,
      /\blead\b/i,
      /\bprospect\b/i,
      /\bcontact\b/i,
      /\bfollow[ -]?up\b/i,
      /\bqualif/i,
      /\bconvert/i,
      /\bhubspot\b/i,
      /\bproduct\b/i,
      /\bpricing\b/i,
      /\bsku\b/i,
      /\border\b/i,
      /\bcheckout\b/i,
      /reply to (them|this|customer|prospect)/i,
    ],
  },
  {
    profile: "reputation_operator",
    reason: "message appears to be about reviews, local listings, or reputation management",
    matchers: [
      /\breview\b/i,
      /\brating\b/i,
      /google business/i,
      /business profile/i,
      /reputation/i,
      /listing/i,
      /\bhours\b/i,
      /local seo/i,
    ],
  },
  {
    profile: "content_operator",
    reason: "message appears to be about drafting, campaigns, scheduling, or publishing content",
    matchers: [
      /\bdraft\b/i,
      /\bcaption\b/i,
      /post idea/i,
      /social post/i,
      /\bschedule\b/i,
      /\bpublish\b/i,
      /\bcampaign\b/i,
      /content calendar/i,
      /creative brief/i,
    ],
  },
  {
    profile: "analyst_operator",
    reason: "message appears to be about metrics, funnels, reporting, or performance analysis",
    matchers: [
      /\banalytics\b/i,
      /\bengagement\b/i,
      /\bimpressions\b/i,
      /\bclicks\b/i,
      /\breport\b/i,
      /\bperformance\b/i,
      /\bfunnel\b/i,
      /\bcompare\b/i,
      /\btrend\b/i,
      /\battribution\b/i,
    ],
  },
  {
    profile: "research_operator",
    reason: "message appears to be about browsing, competitor tracking, or market research",
    matchers: [
      /research/i,
      /browse/i,
      /web/i,
      /website/i,
      /competitor/i,
      /market/i,
      /current/i,
      /latest/i,
      /what(?:'s| is) happening/i,
    ],
  },
];

export function listAgentProfileDescriptors(): AgentProfileDescriptor[] {
  return Object.values(PROFILE_DESCRIPTORS);
}

export function getAgentProfileDescriptor(profile: AgentProfile): AgentProfileDescriptor {
  return PROFILE_DESCRIPTORS[profile];
}

const PROFILE_DESCRIPTORS: Record<AgentProfile, AgentProfileDescriptor> = {
  general_operator: {
    id: "general_operator",
    label: "General Operator",
    mission: "Coordinate across BizBot's business systems with bounded autonomy and route to specialists when needed.",
    delegationTargets: ["sales_operator", "content_operator", "reputation_operator", "analyst_operator", "research_operator", "platform_operator", "builder_operator"],
    toolPolicy: {
      allowedPrefixes: ["agent_", "social_", "content_", "crm_", "memory_", "file_", "graph_", "schedule_", "approval_", "browser_", "competitor_", "sidecar_"],
    },
    prompt: {
      systemInstruction: "Business lane: general operator. Coordinate sales, content, reputation, analytics, and research work. Prefer calling the fewest tools needed and keep handoffs explicit.",
      googleSearch: false,
      googleCodeExecution: false,
      forceToolUse: false,
    },
  },
  sales_operator: {
    id: "sales_operator",
    label: "Sales Operator",
    mission: "Capture, qualify, and advance leads toward conversion using CRM-safe actions.",
    delegationTargets: ["research_operator", "content_operator", "analyst_operator"],
    toolPolicy: {
      allowedPrefixes: ["agent_", "crm_", "social_", "memory_", "graph_", "file_", "approval_", "commerce_", "sidecar_"],
    },
    prompt: {
      systemInstruction: "Business lane: sales operator. Prioritize CRM state, lead qualification, and conversion-safe communication. Use CRM and social tools before improvising account details.",
      googleSearch: false,
      googleCodeExecution: false,
      forceToolUse: true,
    },
  },
  content_operator: {
    id: "content_operator",
    label: "Content Operator",
    mission: "Create and route campaign content through approval-safe publishing workflows.",
    delegationTargets: ["research_operator", "analyst_operator"],
    toolPolicy: {
      allowedPrefixes: ["agent_", "content_", "social_", "memory_", "file_", "schedule_", "approval_", "competitor_", "commerce_", "local_business_", "sidecar_"],
    },
    prompt: {
      systemInstruction: "Business lane: content operator. Prioritize campaign quality, brand consistency, approvals, and scheduling discipline.",
      googleSearch: false,
      googleCodeExecution: false,
      forceToolUse: true,
    },
  },
  reputation_operator: {
    id: "reputation_operator",
    label: "Reputation Operator",
    mission: "Protect and improve public reputation across reviews, public replies, and local presence.",
    delegationTargets: ["research_operator", "analyst_operator"],
    toolPolicy: {
      allowedPrefixes: ["agent_", "social_", "browser_", "memory_", "file_", "graph_", "approval_", "local_business_", "sidecar_"],
    },
    prompt: {
      systemInstruction: "Business lane: reputation operator. Prioritize careful public communication, response quality, and evidence-backed decisions. Use browser and social tools before making claims.",
      googleSearch: true,
      googleCodeExecution: false,
      forceToolUse: true,
    },
  },
  analyst_operator: {
    id: "analyst_operator",
    label: "Analyst Operator",
    mission: "Explain performance, pipeline movement, and operating risk with quantified evidence.",
    delegationTargets: ["sales_operator", "content_operator", "research_operator", "platform_operator"],
    toolPolicy: {
      allowedPrefixes: ["agent_", "crm_", "social_", "memory_", "graph_", "browser_", "competitor_", "developer_", "commerce_", "local_business_", "sidecar_"],
    },
    prompt: {
      systemInstruction: "Business lane: analyst operator. Quantify claims, inspect systems and pipeline state directly, and prefer structured tool outputs over narrative guesses.",
      googleSearch: false,
      googleCodeExecution: true,
      forceToolUse: true,
    },
  },
  research_operator: {
    id: "research_operator",
    label: "Research Operator",
    mission: "Gather grounded external context to improve sales, content, and strategy decisions.",
    delegationTargets: ["sales_operator", "content_operator", "analyst_operator"],
    toolPolicy: {
      allowedPrefixes: ["agent_", "browser_", "competitor_", "memory_", "file_", "graph_", "crm_", "social_", "local_business_", "commerce_", "sidecar_"],
    },
    prompt: {
      systemInstruction: "Business lane: research operator. Prefer grounded browsing, extraction, and competitor evidence. Be explicit about what is observed versus inferred.",
      googleSearch: true,
      googleCodeExecution: false,
      forceToolUse: true,
    },
  },
  platform_operator: {
    id: "platform_operator",
    label: "Platform Operator",
    mission: "Inspect and stabilize the BizBot runtime, tool surfaces, workers, and MCP control loop.",
    delegationTargets: ["analyst_operator", "general_operator", "builder_operator"],
    toolPolicy: {
      allowedPrefixes: ["agent_", "developer_", "file_", "memory_", "graph_", "browser_", "competitor_", "crm_", "commerce_", "local_business_", "sidecar_"],
      allowedTools: ["approval_get_pending", "schedule_list"],
    },
    prompt: {
      systemInstruction: "Business lane: platform operator. Diagnose runtime state, queue state, MCP visibility, and memory/tool behavior before proposing fixes.",
      googleSearch: false,
      googleCodeExecution: true,
      forceToolUse: true,
    },
  },
  builder_operator: {
    id: "builder_operator",
    label: "Builder Operator",
    mission: "Operate inside a dedicated external build workspace for scaffolding, file generation, and safe command orchestration.",
    delegationTargets: ["platform_operator", "general_operator"],
    toolPolicy: {
      allowedPrefixes: ["builder_", "memory_", "sidecar_"],
      deniedTools: [
        "builder_plan_task",
        "builder_continue_task",
        "builder_run_agentic_task",
        "builder_run_script",
        "builder_run_command",
      ],
    },
    prompt: {
      systemInstruction: "Builder lane: operate only inside the dedicated builder workspace, prefer deterministic scaffolds and bounded commands, and never target the BizBot repository.",
      googleSearch: false,
      googleCodeExecution: true,
      forceToolUse: true,
    },
  },
  mcp_operator: {
    id: "mcp_operator",
    label: "MCP Operator",
    mission: "Expose a bounded operator-grade BizBot control surface over MCP without inheriting the full internal platform lane.",
    delegationTargets: [],
    toolPolicy: {
      allowedPrefixes: ["builder_", "developer_", "file_", "memory_", "graph_", "crm_", "commerce_", "local_business_", "sidecar_"],
      allowedTools: ["approval_get_pending", "schedule_list"],
      deniedTools: ["agent_delegate_run"],
    },
    prompt: {
      systemInstruction: "Business lane: MCP operator. Serve as a bounded control-plane surface for external MCP clients. Prefer inspection and deliberate state changes over broad autonomy.",
      googleSearch: false,
      googleCodeExecution: true,
      forceToolUse: true,
    },
  },
};

export interface AgentProfilePromptContext {
  systemInstruction: string;
  streamLabel: string;
  googleSearch: boolean;
  googleCodeExecution: boolean;
  forceToolUse: boolean;
}

export function routeAgentProfile(message: string): AgentProfileDecision {
  for (const rule of PROFILE_RULES) {
    if (rule.matchers.some((matcher) => matcher.test(message))) {
      return {
        profile: rule.profile,
        reason: rule.reason,
      };
    }
  }

  return {
    profile: "general_operator",
    reason: "message does not strongly match a specialist lane",
  };
}

export function canProfileUseTool(profile: AgentProfile, toolName: string): boolean {
  const descriptor = getAgentProfileDescriptor(profile);
  if (descriptor.toolPolicy.deniedTools?.includes(toolName)) {
    return false;
  }
  if (descriptor.toolPolicy.allowedTools?.includes(toolName)) {
    return true;
  }

  return descriptor.toolPolicy.allowedPrefixes.some((prefix) => toolName.startsWith(prefix));
}

export function buildAgentProfilePrompt(profile: AgentProfile, message: string): AgentProfilePromptContext {
  const lower = message.toLowerCase();
  const descriptor = getAgentProfileDescriptor(profile);

  return {
    streamLabel: descriptor.label,
    systemInstruction: `${descriptor.prompt.systemInstruction} Mission: ${descriptor.mission}`,
    googleSearch: descriptor.prompt.googleSearch || /trend|current|latest|news|benchmark|market/.test(lower),
    googleCodeExecution: descriptor.prompt.googleCodeExecution || /calculate|estimate|forecast|analy[sz]e|compare/.test(lower),
    forceToolUse: descriptor.prompt.forceToolUse,
  };
}