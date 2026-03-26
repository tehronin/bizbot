/**
 * browser/safety.ts — URL allowlist and browser action classification.
 *
 * Read-only actions (navigate, screenshot, extract, extractLinks) are auto-allowed.
 * Write actions (fillForm, click, download) require approval queue routing.
 */

import { db } from "@/lib/db";
import { PolicyType } from "@prisma/client";

export type BrowserActionCategory = "read" | "write";

const READ_ACTIONS = new Set(["navigate", "screenshot", "extract", "extractLinks"]);

export function classifyAction(actionType: string): BrowserActionCategory {
  return READ_ACTIONS.has(actionType) ? "read" : "write";
}

/**
 * Check whether a URL is allowed by the current browser allowlist policies.
 * Returns { allowed: true } or { allowed: false, reason: string }.
 */
export async function checkUrlAllowed(
  url: string,
): Promise<{ allowed: boolean; reason?: string }> {
  // Validate URL structure first
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { allowed: false, reason: "Invalid URL" };
  }

  // Block non-http(s) protocols
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { allowed: false, reason: `Protocol ${parsed.protocol} is not allowed` };
  }

  // Load allowlist/blocklist policy from DB
  const policies = await db.policy.findMany({
    where: { type: PolicyType.BROWSER_ALLOWLIST, active: true },
  });

  for (const policy of policies) {
    const rules = policy.rules as {
      allowlist?: string[];
      blocklist?: string[];
    };

    if (rules.blocklist) {
      for (const blocked of rules.blocklist) {
        if (parsed.hostname.includes(blocked)) {
          return { allowed: false, reason: `Domain blocked by policy "${policy.name}"` };
        }
      }
    }

    if (rules.allowlist && rules.allowlist.length > 0) {
      const isAllowed = rules.allowlist.some((allowed) =>
        parsed.hostname.includes(allowed),
      );
      if (!isAllowed) {
        return {
          allowed: false,
          reason: `Domain not in allowlist of policy "${policy.name}"`,
        };
      }
    }
  }

  return { allowed: true };
}

/** Create a pending BrowserAction record in the DB for write actions. */
export async function createPendingAction(
  url: string,
  actionType: string,
  description: string,
  screenshotPath?: string,
): Promise<string> {
  const action = await db.browserAction.create({
    data: {
      url,
      actionType: actionType as import("@prisma/client").BrowserActionType,
      description,
      screenshotPath,
      status: "PENDING",
    },
  });
  return action.id;
}
