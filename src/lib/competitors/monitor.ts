import { PlatformType, Prisma, type CompetitorSnapshot, type CompetitorWatch } from "@prisma/client";
import { createHash } from "node:crypto";
import { chatComplete } from "@/lib/agent/kernel";
import { db } from "@/lib/db";
import { checkUrlAllowed } from "@/lib/browser/safety";
import { extractLinks, extractText } from "@/lib/browser/engine";

interface CreateCompetitorWatchInput {
  name: string;
  url: string;
  platformHint?: "twitter" | "facebook" | "instagram";
  extractSelector?: string;
  notes?: string;
  checkEveryMinutes?: number;
}

interface CompetitorCheckResult {
  watch: CompetitorWatch;
  snapshot?: CompetitorSnapshot;
  changed: boolean;
  summary: string;
}

function toPlatformType(platformHint: CreateCompetitorWatchInput["platformHint"]): PlatformType | undefined {
  switch (platformHint) {
    case "twitter":
      return PlatformType.TWITTER;
    case "facebook":
      return PlatformType.FACEBOOK;
    case "instagram":
      return PlatformType.INSTAGRAM;
    default:
      return undefined;
  }
}

function toSnapshotLinksInput(links: Array<{ text: string; href: string }>): Prisma.InputJsonArray {
  return links.map((link) => ({ text: link.text, href: link.href }));
}

async function summarizeCompetitorChange(watch: CompetitorWatch, excerpt: string): Promise<string> {
  try {
    const response = await chatComplete([
      {
        role: "system",
        content:
          "You summarize competitor activity for a business operator. Return 2-4 concise sentences focused on offers, messaging changes, calls to action, and anything worth reacting to.",
      },
      {
        role: "user",
        content: `Watch: ${watch.name}\nURL: ${watch.url}\n\nExtracted page text:\n${excerpt}`,
      },
    ]);

    return response.content.trim() || excerpt.slice(0, 300);
  } catch {
    return excerpt.slice(0, 300);
  }
}

export async function createCompetitorWatch(input: CreateCompetitorWatchInput) {
  return db.competitorWatch.create({
    data: {
      name: input.name,
      url: input.url,
      platformHint: toPlatformType(input.platformHint),
      extractSelector: input.extractSelector,
      notes: input.notes,
      checkEveryMinutes: Math.max(5, Math.trunc(input.checkEveryMinutes ?? 60)),
    },
  });
}

export async function listCompetitorWatches(active?: boolean) {
  return db.competitorWatch.findMany({
    where: typeof active === "boolean" ? { active } : undefined,
    include: {
      snapshots: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function setCompetitorWatchActive(id: string, active: boolean) {
  return db.competitorWatch.update({
    where: { id },
    data: { active },
  });
}

export async function checkCompetitorWatch(id: string): Promise<CompetitorCheckResult> {
  const watch = await db.competitorWatch.findUnique({ where: { id } });
  if (!watch) {
    throw new Error(`Competitor watch not found: ${id}`);
  }

  const access = await checkUrlAllowed(watch.url);
  if (!access.allowed) {
    const updated = await db.competitorWatch.update({
      where: { id },
      data: {
        lastCheckedAt: new Date(),
        lastError: access.reason ?? "URL blocked by browser policy.",
      },
    });

    return {
      watch: updated,
      changed: false,
      summary: access.reason ?? "URL blocked by browser policy.",
    };
  }

  const extracted = await extractText(watch.url, watch.extractSelector ?? undefined);
  const links = await extractLinks(watch.url);
  const excerpt = extracted.text.slice(0, 6000).trim();
  const contentHash = createHash("sha256").update(excerpt).digest("hex");
  const changed = watch.lastHash !== contentHash;
  const summary = await summarizeCompetitorChange(watch, excerpt);

  const updatedWatch = await db.competitorWatch.update({
    where: { id },
    data: {
      lastCheckedAt: new Date(),
      lastChangedAt: changed ? new Date() : watch.lastChangedAt,
      lastHash: contentHash,
      lastSummary: summary,
      lastError: null,
    },
  });

  let snapshot: CompetitorSnapshot | undefined;
  if (changed || !watch.lastHash) {
    snapshot = await db.competitorSnapshot.upsert({
      where: {
        watchId_contentHash: {
          watchId: watch.id,
          contentHash,
        },
      },
      update: {
        changeDetected: changed,
        summary,
        excerpt,
        links: toSnapshotLinksInput(links.links),
      },
      create: {
        watchId: watch.id,
        changeDetected: changed,
        summary,
        excerpt,
        links: toSnapshotLinksInput(links.links),
        contentHash,
      },
    });
  }

  return {
    watch: updatedWatch,
    snapshot,
    changed,
    summary,
  };
}

export async function runDueCompetitorChecks(limit = 5) {
  const watches = await db.competitorWatch.findMany({
    where: { active: true },
    orderBy: { updatedAt: "asc" },
    take: limit,
  });

  let checked = 0;
  let changed = 0;
  let failed = 0;

  for (const watch of watches) {
    const due = !watch.lastCheckedAt
      || Date.now() - watch.lastCheckedAt.getTime() >= watch.checkEveryMinutes * 60_000;
    if (!due) {
      continue;
    }

    checked += 1;
    try {
      const result = await checkCompetitorWatch(watch.id);
      if (result.changed) {
        changed += 1;
      }
    } catch (error) {
      failed += 1;
      await db.competitorWatch.update({
        where: { id: watch.id },
        data: {
          lastCheckedAt: new Date(),
          lastError: String(error),
        },
      });
    }
  }

  return { checked, changed, failed };
}