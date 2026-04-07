/**
 * ContentPlugin — Draft, refine, and policy-check content before posting.
 */

import { chatCompleteWithRunAccounting } from "@/lib/agent/accounted-chat";
import { evaluateContent } from "@/lib/policies/engine";
import { defineTool, registerTool, type ToolDefinition } from "@/lib/agent/tools";
import type { PolicyResult } from "@/lib/policies/engine";

type ContentPlatform = "twitter" | "facebook" | "instagram";

interface DraftArgs {
  topic: string;
  platform: ContentPlatform;
  tone?: string;
  maxLength?: number;
}

interface RefineArgs {
  content: string;
  instruction: string;
}

interface PolicyArgs {
  content: string;
}

export const contentPlugin = {
  tools: [
    registerTool(defineTool({
      name: "content_draft",
      description: "Draft social media content for a given topic, platform, and tone.",
      parameters: {
        type: "object",
        properties: {
          topic: { type: "string" },
          platform: { type: "string", enum: ["twitter", "facebook", "instagram"] },
          tone: { type: "string", description: "e.g. professional, casual, witty" },
          maxLength: { type: "number" },
        },
        required: ["topic", "platform"],
      },
      execute: async ({ topic, platform, tone, maxLength }: DraftArgs, context) => {
        const limits: Record<ContentPlatform, number> = {
          twitter: 280,
          facebook: 63206,
          instagram: 2200,
        };
        const limit = maxLength ?? limits[platform] ?? 500;
        const result = await chatCompleteWithRunAccounting([
          {
            role: "system",
            content: `You are a social media content writer. Write engaging ${platform} posts. Stay within ${limit} characters.`,
          },
          {
            role: "user",
            content: `Write a ${tone ?? "professional"} post about: ${topic}`,
          },
        ], context);
        return { draft: result.content, characterCount: result.content.length };
      },
    } satisfies ToolDefinition<DraftArgs, { draft: string; characterCount: number }>)),
    registerTool(defineTool({
      name: "content_refine",
      description: "Refine existing content based on feedback or instructions.",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string" },
          instruction: { type: "string", description: "How to refine the content" },
        },
        required: ["content", "instruction"],
      },
      execute: async ({ content, instruction }: RefineArgs, context) => {
        const result = await chatCompleteWithRunAccounting([
          { role: "system", content: "You are a content editor. Refine the given content based on the instruction. Return only the refined content." },
          { role: "user", content: `Content:\n${content}\n\nInstruction: ${instruction}` },
        ], context);
        return { refined: result.content };
      },
    } satisfies ToolDefinition<RefineArgs, { refined: string }>)),
    registerTool(defineTool({
      name: "content_check_policy",
      description: "Check if content passes all active policies before posting.",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string" },
        },
        required: ["content"],
      },
      execute: async ({ content }: PolicyArgs) => {
        return evaluateContent(content);
      },
    } satisfies ToolDefinition<PolicyArgs, PolicyResult>)),
  ],
};
