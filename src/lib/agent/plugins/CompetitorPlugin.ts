import { defineTool, registerTool, type ToolDefinition } from "@/lib/agent/tools";
import {
  checkCompetitorWatch,
  createCompetitorWatch,
  listCompetitorWatches,
  setCompetitorWatchActive,
} from "@/lib/competitors/monitor";

interface CompetitorWatchCreateArgs {
  name: string;
  url: string;
  platformHint?: "twitter" | "facebook" | "instagram";
  extractSelector?: string;
  notes?: string;
  checkEveryMinutes?: number;
}

interface CompetitorWatchCheckArgs {
  watchId: string;
}

interface CompetitorWatchPauseArgs {
  watchId: string;
  active: boolean;
}

export const competitorPlugin = {
  tools: [
    registerTool(defineTool({
      name: "competitor_watch_create",
      description: "Create a browser-monitored competitor watch for a public URL.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          url: { type: "string" },
          platformHint: { type: "string", enum: ["twitter", "facebook", "instagram"] },
          extractSelector: { type: "string" },
          notes: { type: "string" },
          checkEveryMinutes: { type: "number" },
        },
        required: ["name", "url"],
      },
      execute: async (args: CompetitorWatchCreateArgs) => createCompetitorWatch(args),
    } satisfies ToolDefinition<CompetitorWatchCreateArgs, Awaited<ReturnType<typeof createCompetitorWatch>>>)),
    registerTool(defineTool({
      name: "competitor_watch_list",
      description: "List configured competitor watches and their latest snapshot.",
      parameters: {
        type: "object",
        properties: {},
      },
      execute: async () => ({
        watches: await listCompetitorWatches(),
      }),
    } satisfies ToolDefinition<Record<string, never>, { watches: Awaited<ReturnType<typeof listCompetitorWatches>> }>)),
    registerTool(defineTool({
      name: "competitor_watch_check",
      description: "Run a competitor watch immediately and summarize the latest detected change.",
      parameters: {
        type: "object",
        properties: {
          watchId: { type: "string" },
        },
        required: ["watchId"],
      },
      execute: async ({ watchId }: CompetitorWatchCheckArgs) => checkCompetitorWatch(watchId),
    } satisfies ToolDefinition<CompetitorWatchCheckArgs, Awaited<ReturnType<typeof checkCompetitorWatch>>>)),
    registerTool(defineTool({
      name: "competitor_watch_pause",
      description: "Pause or resume a competitor watch.",
      parameters: {
        type: "object",
        properties: {
          watchId: { type: "string" },
          active: { type: "boolean" },
        },
        required: ["watchId", "active"],
      },
      execute: async ({ watchId, active }: CompetitorWatchPauseArgs) =>
        setCompetitorWatchActive(watchId, active),
    } satisfies ToolDefinition<CompetitorWatchPauseArgs, Awaited<ReturnType<typeof setCompetitorWatchActive>>>)),
  ],
};