/**
 * social/browser/facebook.ts — Experimental browser-based Facebook adapter.
 *
 * ⚠️  EXPERIMENTAL — Opt-in only. Disabled by default.
 * Using browser automation to access Facebook violates Meta's Terms of Service.
 * This adapter may cause account restrictions or bans. Use at your own risk.
 * Recommended approach: Use the official Graph API in Development Mode instead.
 */

import { chromium, Browser, BrowserContext, Page } from "playwright";
import { loadSession, saveSession, getDomain } from "@/lib/browser/session";
import type {
  SocialClient,
  SocialPost,
  SocialReply,
  SocialMention,
  EngagementMetrics,
  PostInput,
} from "../types";
import { sleep } from "../types";

const FB_DOMAIN = "facebook.com";

export class FacebookBrowserClient implements SocialClient {
  platform = "facebook" as const;
  private browser: Browser | null = null;

  isConnected(): boolean {
    // Browser mode connection status is based on whether credentials are stored
    return !!(
      process.env.FACEBOOK_EMAIL && process.env.FACEBOOK_PASSWORD
    );
  }

  private async getBrowserContext(): Promise<{
    ctx: BrowserContext;
    page: Page;
  }> {
    if (!this.browser || !this.browser.isConnected()) {
      this.browser = await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
      });
    }
    const cookies = await loadSession(FB_DOMAIN);
    const ctx = await this.browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    if (cookies.length > 0) {
      await ctx.addCookies(cookies as Parameters<BrowserContext["addCookies"]>[0]);
    }
    const page = await ctx.newPage();
    return { ctx, page };
  }

  private async ensureLoggedIn(page: Page, ctx: BrowserContext): Promise<void> {
    await page.goto("https://www.facebook.com/", { waitUntil: "networkidle" });
    const isLoggedIn = await page.$('[aria-label="Your profile"]').then(Boolean);
    if (!isLoggedIn) {
      await page.fill('[data-testid="royal_email"]', process.env.FACEBOOK_EMAIL ?? "");
      await sleep(500 + Math.random() * 500);
      await page.fill('[data-testid="royal_pass"]', process.env.FACEBOOK_PASSWORD ?? "");
      await sleep(300 + Math.random() * 300);
      await page.click('[data-testid="royal_login_button"]');
      await page.waitForNavigation({ waitUntil: "networkidle", timeout: 15_000 });
      const cookies = await ctx.cookies();
      await saveSession(getDomain("https://facebook.com"), cookies);
    }
  }

  async post(input: PostInput): Promise<SocialPost> {
    const { ctx, page } = await this.getBrowserContext();
    try {
      await this.ensureLoggedIn(page, ctx);
      // Navigate to page composer — simplified; real implementation would target a specific page
      await page.goto("https://www.facebook.com/", { waitUntil: "networkidle" });
      await page.click('[aria-label="Create a post"]');
      await sleep(800);
      await page.keyboard.type(input.content);
      await sleep(500);
      await page.click('[aria-label="Post"]');
      await page.waitForTimeout(2000);
      const cookies = await ctx.cookies();
      await saveSession(FB_DOMAIN, cookies);
      return {
        id: `fb_browser_${Date.now()}`,
        content: input.content,
        publishedAt: new Date(),
      };
    } finally {
      await ctx.close();
    }
  }

  async reply(replyToId: string, content: string): Promise<SocialReply> {
    void replyToId;
    void content;
    throw new Error("Browser reply not implemented — use Graph API client");
  }

  async getMentions(limit?: number): Promise<SocialMention[]> {
    void limit;
    return []; // Not reliably accessible via browser automation
  }

  async getAnalytics(postId: string): Promise<EngagementMetrics> {
    void postId;
    return { likes: 0, replies: 0, shares: 0, impressions: 0 };
  }
}
