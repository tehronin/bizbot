import { createProjectFromOnboarding } from "@/lib/builder/onboarding";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as Record<string, unknown>;

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return Response.json({ error: "Project name is required." }, { status: 400 });
    }

    const result = await createProjectFromOnboarding(
      {
        name,
        description: typeof body.description === "string" ? body.description : "",
        stackPresetKey: typeof body.stackPresetKey === "string" ? body.stackPresetKey : "",
        template: typeof body.template === "string" ? body.template : "node-cli",
        packageManager: typeof body.packageManager === "string" ? body.packageManager : "NPM",
        docker: body.docker !== false,
        git: body.git !== false,
      },
      {
        conversationId: typeof body.conversationId === "string" ? body.conversationId : undefined,
      },
    );

    return Response.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create project from onboarding.";
    return Response.json({ error: message }, { status: 500 });
  }
}
