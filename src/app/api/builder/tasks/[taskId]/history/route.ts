import { getBuilderTaskHistory } from "@/lib/builder/tasks";

export async function GET(
  _req: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await context.params;
    const history = await getBuilderTaskHistory(taskId);
    return Response.json({ history });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}