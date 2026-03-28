import { NextRequest } from "next/server";
import { getBuilderConfig } from "@/lib/builder/config";
import { runBuilderProjectBootstrap } from "@/lib/builder/bootstrap";

function parseBootstrapRequest(value: object | null, defaults: ReturnType<typeof getBuilderConfig>): {
  initializeGit: boolean;
  installDependencies: boolean;
} {
  if (!value || Array.isArray(value)) {
    return {
      initializeGit: defaults.initializeGitByDefault,
      installDependencies: defaults.installDependenciesByDefault,
    };
  }

  const candidate = value as Record<string, unknown>;
  return {
    initializeGit: typeof candidate.initializeGit === "boolean" ? candidate.initializeGit : defaults.initializeGitByDefault,
    installDependencies: typeof candidate.installDependencies === "boolean" ? candidate.installDependencies : defaults.installDependenciesByDefault,
  };
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const defaults = getBuilderConfig();
    const { id } = await context.params;
    const options = parseBootstrapRequest(await req.json().catch(() => null), defaults);
    return Response.json(await runBuilderProjectBootstrap(id, options));
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}