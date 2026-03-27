/**
 * browser/engine.ts — Playwright browser instance management.
 * Provides a pooled, lazily-initialized Chromium browser for the agent.
 */

import { chromium, Browser, BrowserContext, Page } from "playwright";
import path from "path";
import fs from "fs";
import type { BrowserCookie, ExtractedLink } from "@/lib/browser/types";
import { resolveFromAppHome } from "@/lib/runtime-paths";

const SCREENSHOT_DIR = resolveFromAppHome("workspace", "screenshots");

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
      ],
    });
  }
  return browser;
}

async function newContext(storedCookies?: BrowserCookie[]): Promise<BrowserContext> {
  const b = await getBrowser();
  const ctx = await b.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "en-US",
  });

  if (storedCookies && storedCookies.length > 0) {
    await ctx.addCookies(storedCookies);
  }

  return ctx;
}

export interface PageResult {
  url: string;
  title: string;
  text: string;
}

/** Navigate to a URL and return the page title and text content. */
export async function navigatePage(
  url: string,
  savedCookies?: BrowserCookie[],
): Promise<{ result: PageResult; cookies: BrowserCookie[] }> {
  const ctx = await newContext(savedCookies);
  const page: Page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const title = await page.title();
    const text = await page.evaluate(() => document.body.innerText ?? "");
    const cookies = await ctx.cookies();
    return {
      result: { url: page.url(), title, text: text.slice(0, 10_000) },
      cookies,
    };
  } finally {
    await ctx.close();
  }
}

/** Take a screenshot of a URL and save it to the workspace screenshots folder. */
export async function screenshotPage(
  url: string,
  filename: string,
  savedCookies?: BrowserCookie[],
): Promise<string> {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }
  // Sanitize filename to prevent path traversal
  const safe = path.basename(filename).replace(/[^a-zA-Z0-9_\-\.]/g, "_");
  const filePath = path.join(SCREENSHOT_DIR, safe.endsWith(".png") ? safe : `${safe}.png`);

  const ctx = await newContext(savedCookies);
  const page: Page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.screenshot({ path: filePath, fullPage: false });
    return filePath;
  } finally {
    await ctx.close();
  }
}

/** Extract text content from a page using an optional CSS selector. */
export async function extractText(
  url: string,
  selector?: string,
  savedCookies?: BrowserCookie[],
): Promise<{ text: string; cookies: BrowserCookie[] }> {
  const ctx = await newContext(savedCookies);
  const page: Page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    let text: string;
    if (selector) {
      text = await page.locator(selector).first().innerText({ timeout: 5000 });
    } else {
      text = await page.evaluate(() => document.body.innerText ?? "");
    }
    const cookies = await ctx.cookies();
    return { text: text.slice(0, 20_000), cookies };
  } finally {
    await ctx.close();
  }
}

/** Extract all links from a page, optionally filtered by a URL pattern. */
export async function extractLinks(
  url: string,
  filterPattern?: string,
  savedCookies?: BrowserCookie[],
): Promise<{ links: ExtractedLink[]; cookies: BrowserCookie[] }> {
  const ctx = await newContext(savedCookies);
  const page: Page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const links = await page.evaluate<ExtractedLink[]>(() => {
      const anchors = Array.from(document.querySelectorAll("a[href]"));
      return anchors.slice(0, 500).map((a) => ({
        text: (a as HTMLAnchorElement).innerText.trim().slice(0, 200),
        href: (a as HTMLAnchorElement).href,
      }));
    });
    const cookies = await ctx.cookies();
    const filtered = filterPattern
      ? links.filter((l) => l.href.includes(filterPattern))
      : links;
    return { links: filtered.slice(0, 100), cookies };
  } finally {
    await ctx.close();
  }
}

/** Shut down the browser gracefully. */
export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}
