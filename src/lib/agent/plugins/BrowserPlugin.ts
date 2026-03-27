/** BrowserPlugin — Agent tools for Playwright-powered web browsing. */

import {
  navigatePage,
  screenshotPage,
  extractText,
  extractLinks,
} from "@/lib/browser/engine";
import { checkUrlAllowed } from "@/lib/browser/safety";
import { defineTool, registerTool, type ToolDefinition } from "@/lib/agent/tools";

interface NavigateArgs {
  url: string;
  domain?: string;
}

interface ScreenshotArgs {
  url: string;
  filename: string;
}

interface ExtractTextArgs {
  url: string;
  selector?: string;
}

interface ExtractLinksArgs {
  url: string;
  filter?: string;
}

export const browserPlugin = {
  tools: [
    registerTool(defineTool({
      name: "browser_navigate",
      description: "Navigate to a URL and return the full page HTML.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string" },
          domain: { type: "string", description: "Optional domain for session cookies" },
        },
        required: ["url"],
      },
      execute: async ({ url }: NavigateArgs) => {
        const access = await checkUrlAllowed(url);
        if (!access.allowed) {
          return { error: access.reason ?? "URL is not on the browser allowlist." };
        }
        const page = await navigatePage(url);
        return { url, title: page.result.title, text: page.result.text };
      },
    } satisfies ToolDefinition<NavigateArgs, { error: string } | { url: string; title: string; text: string }>)),
    registerTool(defineTool({
      name: "browser_screenshot",
      description: "Take a screenshot of a URL and save it to the workspace.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string" },
          filename: { type: "string" },
        },
        required: ["url", "filename"],
      },
      execute: async ({ url, filename }: ScreenshotArgs) => {
        const access = await checkUrlAllowed(url);
        if (!access.allowed) {
          return { error: access.reason ?? "URL is not on the browser allowlist." };
        }
        const savedPath = await screenshotPage(url, filename);
        return { url, savedPath };
      },
    } satisfies ToolDefinition<ScreenshotArgs, { error: string } | { url: string; savedPath: string }>)),
    registerTool(defineTool({
      name: "browser_extract_text",
      description: "Extract visible text from a page, optionally scoped to a CSS selector.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string" },
          selector: { type: "string" },
        },
        required: ["url"],
      },
      execute: async ({ url, selector }: ExtractTextArgs) => {
        const access = await checkUrlAllowed(url);
        if (!access.allowed) {
          return { error: access.reason ?? "URL is not on the browser allowlist." };
        }
        const extracted = await extractText(url, selector);
        return { url, text: extracted.text.slice(0, 10_000) };
      },
    } satisfies ToolDefinition<ExtractTextArgs, { error: string } | { url: string; text: string }>)),
    registerTool(defineTool({
      name: "browser_extract_links",
      description: "Extract all hyperlinks from a page, with optional URL filter substring.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string" },
          filter: { type: "string" },
        },
        required: ["url"],
      },
      execute: async ({ url, filter }: ExtractLinksArgs) => {
        const access = await checkUrlAllowed(url);
        if (!access.allowed) {
          return { error: access.reason ?? "URL is not on the browser allowlist." };
        }
        const extracted = await extractLinks(url, filter);
        return { url, links: extracted.links };
      },
    } satisfies ToolDefinition<ExtractLinksArgs, { error: string } | { url: string; links: Array<{ text: string; href: string }> }>)),
  ],
};
