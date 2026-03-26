/**
 * policies/engine.ts — Central policy evaluation engine.
 * Evaluates content against all active policies before posting.
 */

import { db } from "@/lib/db";
import { PolicyType } from "@prisma/client";
import { checkGuardrails } from "./guardrails";
import { checkBrandVoice } from "./voice";

export interface PolicyResult {
  passed: boolean;
  violations: PolicyViolation[];
  voiceScore?: number; // 0-100, higher = better match
}

export interface PolicyViolation {
  policyName: string;
  policyType: PolicyType;
  message: string;
}

/**
 * Evaluate content against all active policies.
 * Returns a PolicyResult indicating pass/fail and any violations.
 */
export async function evaluateContent(content: string): Promise<PolicyResult> {
  const violations: PolicyViolation[] = [];
  let voiceScore: number | undefined;

  const policies = await db.policy.findMany({ where: { active: true } });

  for (const policy of policies) {
    if (policy.type === PolicyType.GUARDRAIL) {
      const result = checkGuardrails(
        content,
        policy.rules as { bannedWords?: string[]; bannedTopics?: string[]; maxLength?: number },
      );
      if (!result.passed) {
        violations.push({
          policyName: policy.name,
          policyType: PolicyType.GUARDRAIL,
          message: result.message ?? "Content violates guardrail policy",
        });
      }
    }

    if (policy.type === PolicyType.BRAND_VOICE && policy.description) {
      const result = await checkBrandVoice(content, policy.description, policy.rules as { minScore?: number });
      voiceScore = result.score;
      if (!result.passed) {
        violations.push({
          policyName: policy.name,
          policyType: PolicyType.BRAND_VOICE,
          message: `Brand voice score ${result.score}/100 is below minimum ${result.minScore}/100`,
        });
      }
    }
  }

  return {
    passed: violations.length === 0,
    violations,
    voiceScore,
  };
}

/**
 * Check if a post should be auto-approved based on existing auto-approve rules.
 */
export async function checkAutoApprove(content: string): Promise<{ autoApprove: boolean; ruleName?: string }> {
  const rules = await db.policy.findMany({
    where: { type: PolicyType.AUTO_APPROVE, active: true },
  });

  for (const rule of rules) {
    const conditions = rule.rules as {
      contentPatterns?: string[];
      alwaysApprove?: boolean;
    };

    if (conditions.alwaysApprove) {
      return { autoApprove: true, ruleName: rule.name };
    }

    if (conditions.contentPatterns) {
      const matches = conditions.contentPatterns.some((pattern) =>
        content.toLowerCase().includes(pattern.toLowerCase()),
      );
      if (matches) {
        return { autoApprove: true, ruleName: rule.name };
      }
    }
  }

  return { autoApprove: false };
}
