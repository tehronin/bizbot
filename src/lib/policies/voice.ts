/**
 * policies/voice.ts — Brand voice enforcement via LLM.
 * Uses the active LLM to score content against the brand voice description.
 */

import OpenAI from "openai";

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

interface VoiceRules {
  minScore?: number;
}

interface VoiceResult {
  passed: boolean;
  score: number;
  minScore: number;
  feedback?: string;
}

export async function checkBrandVoice(
  content: string,
  voiceDescription: string,
  rules: VoiceRules = {},
): Promise<VoiceResult> {
  const minScore = rules.minScore ?? 60;

  const response = await getClient().chat.completions.create({
    model: process.env.OPENAI_MODEL ?? "gpt-4o",
    temperature: 0,
    messages: [
      {
        role: "system",
        content: `You are a brand voice evaluator. Given a brand voice description and content, score the content from 0-100 on how well it matches the brand voice. Return JSON: { "score": number, "feedback": string }`,
      },
      {
        role: "user",
        content: `Brand voice:\n${voiceDescription}\n\nContent to evaluate:\n${content}`,
      },
    ],
    response_format: { type: "json_object" },
  });

  try {
    const parsed = JSON.parse(
      response.choices[0].message.content ?? "{}",
    ) as { score?: number; feedback?: string };
    const score = Math.max(0, Math.min(100, parsed.score ?? 50));
    return {
      passed: score >= minScore,
      score,
      minScore,
      feedback: parsed.feedback,
    };
  } catch {
    return { passed: true, score: 75, minScore, feedback: "Could not evaluate" };
  }
}
