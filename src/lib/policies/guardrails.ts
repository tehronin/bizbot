/**
 * policies/guardrails.ts — Rule-based content filtering.
 * Fast, synchronous checks for banned words, topics, and length.
 */

interface GuardrailRules {
  bannedWords?: string[];
  bannedTopics?: string[];
  maxLength?: number;
}

interface GuardrailResult {
  passed: boolean;
  message?: string;
}

export function checkGuardrails(
  content: string,
  rules: GuardrailRules,
): GuardrailResult {
  const lower = content.toLowerCase();

  if (rules.maxLength && content.length > rules.maxLength) {
    return {
      passed: false,
      message: `Content exceeds maximum length of ${rules.maxLength} characters`,
    };
  }

  if (rules.bannedWords) {
    for (const word of rules.bannedWords) {
      if (lower.includes(word.toLowerCase())) {
        return {
          passed: false,
          message: `Content contains banned word: "${word}"`,
        };
      }
    }
  }

  if (rules.bannedTopics) {
    for (const topic of rules.bannedTopics) {
      if (lower.includes(topic.toLowerCase())) {
        return {
          passed: false,
          message: `Content references banned topic: "${topic}"`,
        };
      }
    }
  }

  return { passed: true };
}

/** Default guardrail rules — used when no policies are configured. */
export const DEFAULT_GUARDRAIL_RULES: GuardrailRules = {
  maxLength: 10_000,
  bannedWords: [],
  bannedTopics: [],
};
