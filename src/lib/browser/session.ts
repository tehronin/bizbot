/**
 * browser/session.ts — Cookie and session persistence per domain.
 * Sessions are stored in the BrowserSession table in Postgres.
 */

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import type { BrowserCookie } from "@/lib/browser/types";

function isPrismaJsonObject(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toBrowserCookie(value: BrowserCookie | null): BrowserCookie[] {
  return value ? [value] : [];
}

function parseBrowserCookie(value: Prisma.JsonValue): BrowserCookie | null {
  if (!isPrismaJsonObject(value)) {
    return null;
  }

  const sameSite = value.sameSite;
  if (
    typeof value.name !== "string" ||
    typeof value.value !== "string" ||
    typeof value.domain !== "string" ||
    typeof value.path !== "string" ||
    typeof value.expires !== "number" ||
    typeof value.httpOnly !== "boolean" ||
    typeof value.secure !== "boolean" ||
    (sameSite !== "Strict" && sameSite !== "Lax" && sameSite !== "None")
  ) {
    return null;
  }

  return {
    name: value.name,
    value: value.value,
    domain: value.domain,
    path: value.path,
    expires: value.expires,
    httpOnly: value.httpOnly,
    secure: value.secure,
    sameSite,
  };
}

/** Retrieve stored cookies for a domain. Returns empty array if no session found. */
export async function loadSession(domain: string): Promise<BrowserCookie[]> {
  const session = await db.browserSession.findUnique({ where: { domain } });
  if (!session) return [];
  if (!Array.isArray(session.cookies)) {
    return [];
  }

  return session.cookies.flatMap((cookie) =>
    toBrowserCookie(parseBrowserCookie(cookie)),
  );
}

/** Save/update cookies for a domain after a browser interaction. */
export async function saveSession(
  domain: string,
  cookies: BrowserCookie[],
): Promise<void> {
  await db.browserSession.upsert({
    where: { domain },
    create: { domain, cookies: cookies as object[] },
    update: { cookies: cookies as object[] },
  });
}

/** Delete stored session for a domain. */
export async function clearSession(domain: string): Promise<void> {
  await db.browserSession.deleteMany({ where: { domain } });
}

/** Extract top-level domain from a URL for session keying. */
export function getDomain(url: string): string {
  try {
    const parsed = new URL(url);
    const parts = parsed.hostname.split(".");
    if (parts.length >= 2) {
      return parts.slice(-2).join(".");
    }
    return parsed.hostname;
  } catch {
    return url;
  }
}
