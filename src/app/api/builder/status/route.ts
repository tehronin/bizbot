import { db } from "@/lib/db";
import { syncBuilderCliProfiles } from "@/lib/builder/cli-profiles";
import { getBuilderConfig } from "@/lib/builder/config";
import { syncBuilderTemplatePresets } from "@/lib/builder/templates";

export async function GET() {
  const [templates, cliProfiles, projectCount, runningCount] = await Promise.all([
    syncBuilderTemplatePresets(),
    syncBuilderCliProfiles(),
    db.builderProject.count(),
    db.builderProject.count({ where: { lastRunStatus: "RUNNING" } }),
  ]);

  return Response.json({
    config: getBuilderConfig(),
    templates,
    cliProfiles,
    projects: {
      total: projectCount,
      running: runningCount,
    },
  });
}