import { db } from "@/lib/db";
import { syncBuilderCliProfiles } from "@/lib/builder/cli-profiles";
import { getBuilderConfig } from "@/lib/builder/config";
import { listBuilderStackPresets } from "@/lib/builder/stacks";
import { syncBuilderTemplatePresets } from "@/lib/builder/template-presets";

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
    stackPresets: listBuilderStackPresets(),
    cliProfiles,
    projects: {
      total: projectCount,
      running: runningCount,
    },
  });
}