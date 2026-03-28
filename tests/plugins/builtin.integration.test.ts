import { afterEach, describe, expect, it } from "vitest";
import { crmPlugin } from "@/lib/agent/plugins/CrmPlugin";
import { localBusinessPlugin } from "@/lib/agent/plugins/LocalBusinessPlugin";
import { socialPlugin } from "@/lib/agent/plugins/SocialPlugin";
import { resetCrmPluginTestDeps, setCrmPluginTestDeps } from "@/lib/agent/plugins/crm-runtime";
import { resetLocalBusinessPluginTestDeps, setLocalBusinessPluginTestDeps } from "@/lib/agent/plugins/local-business-runtime";
import { resetSocialPluginTestDeps, setSocialPluginTestDeps } from "@/lib/agent/plugins/social-runtime";
import type { SocialClient } from "@/lib/social/types";

function requireTool(tools: Array<{ name: string; execute: (args: Record<string, unknown>, context: Record<string, unknown>) => Promise<unknown> }>, name: string) {
  const tool = tools.find((entry) => entry.name === name);
  expect(tool).toBeDefined();
  return tool!;
}

afterEach(() => {
  resetSocialPluginTestDeps();
  resetCrmPluginTestDeps();
  resetLocalBusinessPluginTestDeps();
});

describe("builtin provider plugins", () => {
  it("uses injected social clients for mentions", async () => {
    const calls: number[] = [];
    const fakeClient: SocialClient = {
      platform: "twitter",
      post: async () => ({ id: "post-1", content: "ignored" }),
      reply: async (replyToId, content) => ({ id: "reply-1", inReplyToId: replyToId, content }),
      getMentions: async (limit = 20) => {
        calls.push(limit);
        return [{
          id: "mention-1",
          authorName: "Fixture User",
          authorHandle: "fixture",
          content: "Need help?",
          createdAt: new Date("2024-01-01T00:00:00.000Z"),
          url: "https://example.com/mention-1",
        }];
      },
      getAnalytics: async () => ({ likes: 1, replies: 2, shares: 3, impressions: 4 }),
      isConnected: () => true,
    };

    setSocialPluginTestDeps({
      getClient: () => fakeClient,
    });

    const tool = requireTool(socialPlugin.tools, "social_get_mentions");
    const result = await tool.execute({ platform: "twitter" }, {});

    expect(result).toEqual([
      {
        id: "mention-1",
        authorName: "Fixture User",
        authorHandle: "fixture",
        content: "Need help?",
        createdAt: new Date("2024-01-01T00:00:00.000Z"),
        url: "https://example.com/mention-1",
      },
    ]);
    expect(calls).toEqual([20]);
  });

  it("uses injected CRM deps for provider status and contact listing", async () => {
    const calls: Array<Record<string, unknown>> = [];

    setCrmPluginTestDeps({
      getActiveProviderName: () => "hubspot",
      getProviderStatuses: async () => [],
      listContacts: async (args) => {
        calls.push(args as Record<string, unknown>);
        return [];
      },
    });

    const providerTool = requireTool(crmPlugin.tools, "crm_get_provider_status");
    const listTool = requireTool(crmPlugin.tools, "crm_list_contacts");

    const providerResult = await providerTool.execute({}, {});
    const listResult = await listTool.execute({ query: "acme" }, {});

    expect(providerResult).toEqual({
      activeProvider: "hubspot",
      providers: [],
    });
    expect(listResult).toEqual({ contacts: [] });
    expect(calls).toEqual([
      {
        stage: undefined,
        query: "acme",
        limit: 25,
      },
    ]);
  });

  it("uses injected local business deps for review listing", async () => {
    const calls: Array<Record<string, unknown>> = [];

    setLocalBusinessPluginTestDeps({
      listReviews: async (args) => {
        calls.push(args as Record<string, unknown>);
        return [];
      },
    });

    const tool = requireTool(localBusinessPlugin.tools, "local_business_list_reviews");
    const result = await tool.execute({ needsResponse: true, limit: 250 }, {});

    expect(result).toEqual({ reviews: [] });
    expect(calls).toEqual([
      {
        where: { needsResponse: true },
        orderBy: { updateTime: "desc" },
        take: 100,
      },
    ]);
  });
});