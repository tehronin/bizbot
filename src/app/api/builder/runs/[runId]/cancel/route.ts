export async function POST(
  _req: Request,
  context: { params: Promise<{ runId: string }> },
) {
  try {
    const { cancelBuilderProjectRun } = await import("@/lib/builder/command-cancel");
    const { runId } = await context.params;
    const result = await cancelBuilderProjectRun(runId);
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}