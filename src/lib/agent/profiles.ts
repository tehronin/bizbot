export type AgentProfile =
  | "general_operator"
  | "dm_handler"
  | "content_creator"
  | "analytics_reporter"
  | "browser_researcher";

export interface AgentProfileDecision {
  profile: AgentProfile;
  reason: string;
}

const PROFILE_RULES: Array<{
  profile: AgentProfile;
  reason: string;
  matchers: RegExp[];
}> = [
  {
    profile: "dm_handler",
    reason: "message appears to be about inbox, DM, or lead-response handling",
    matchers: [
      /\bdm\b/i,
      /direct message/i,
      /messenger/i,
      /inbox/i,
      /lead/i,
      /reply to (them|this|customer|prospect)/i,
    ],
  },
  {
    profile: "content_creator",
    reason: "message appears to be about drafting, scheduling, or publishing content",
    matchers: [
      /draft/i,
      /caption/i,
      /post idea/i,
      /social post/i,
      /schedule/i,
      /publish/i,
      /campaign/i,
      /content calendar/i,
    ],
  },
  {
    profile: "analytics_reporter",
    reason: "message appears to be about metrics, reporting, or performance analysis",
    matchers: [
      /analytics/i,
      /engagement/i,
      /impressions/i,
      /clicks/i,
      /report/i,
      /performance/i,
      /compare/i,
      /trend/i,
    ],
  },
  {
    profile: "browser_researcher",
    reason: "message appears to be about browser research, current events, or competitor tracking",
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

const PROFILE_TOOL_PREFIXES: Record<AgentProfile, string[]> = {
  general_operator: [
    "social_",
    "content_",
    "memory_",
    "file_",
    "graph_",
    "schedule_",
    "approval_",
    "browser_",
    "competitor_",
  ],
  dm_handler: ["social_", "memory_", "file_", "graph_"],
  content_creator: ["social_", "content_", "memory_", "file_", "schedule_", "approval_"],
  analytics_reporter: ["social_", "memory_", "graph_", "browser_", "competitor_"],
  browser_researcher: ["browser_", "memory_", "file_", "graph_", "competitor_", "social_"],
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
  return PROFILE_TOOL_PREFIXES[profile].some((prefix) => toolName.startsWith(prefix));
}

export function buildAgentProfilePrompt(profile: AgentProfile, message: string): AgentProfilePromptContext {
  const lower = message.toLowerCase();

  switch (profile) {
    case "dm_handler":
      return {
        streamLabel: "DM Handler",
        systemInstruction:
          "Specialist lane: DM handling. Prioritize inbox accuracy, customer intent, and safe lead-conversion language. Use social and memory tools before improvising platform facts.",
        googleSearch: false,
        googleCodeExecution: false,
        forceToolUse: true,
      };
    case "content_creator":
      return {
        streamLabel: "Content Creator",
        systemInstruction:
          "Specialist lane: content creation. Prioritize content drafting, policy checks, scheduling, and approval-safe publishing workflows.",
        googleSearch: /trend|current|latest|news|competitor/.test(lower),
        googleCodeExecution: false,
        forceToolUse: true,
      };
    case "analytics_reporter":
      return {
        streamLabel: "Analytics Reporter",
        systemInstruction:
          "Specialist lane: analytics reporting. Prefer analytics, graph, and competitor tools. Quantify claims and keep summaries operational.",
        googleSearch: /benchmark|industry|competitor|market/.test(lower),
        googleCodeExecution: true,
        forceToolUse: true,
      };
    case "browser_researcher":
      return {
        streamLabel: "Browser Researcher",
        systemInstruction:
          "Specialist lane: browser research. Prefer browser navigation, extraction, and competitor tools. Use grounded, source-aware reasoning for current information.",
        googleSearch: true,
        googleCodeExecution: /compare|analy[sz]e|summarize table|count|calculate/.test(lower),
        forceToolUse: true,
      };
    case "general_operator":
      return {
        streamLabel: "General Operator",
        systemInstruction:
          "Specialist lane: general operator. Coordinate tools across content, social, memory, analytics, browser, and approvals as needed.",
        googleSearch: /current|latest|today|recent|news/.test(lower),
        googleCodeExecution: /calculate|estimate|forecast|analy[sz]e/.test(lower),
        forceToolUse: false,
      };
  }
}