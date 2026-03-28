import { NextRequest } from "next/server";
import { updateCrmContactActivity } from "@/lib/crm";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = (await req.json()) as {
      title?: string | null;
      subject?: string | null;
      body?: string;
      status?: string;
      priority?: string | null;
      dueAt?: string | null;
    };

    const activity = await updateCrmContactActivity({
      activityId: id,
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.subject !== undefined ? { subject: body.subject } : {}),
      ...(body.body !== undefined ? { body: body.body } : {}),
      ...(body.status !== undefined ? { status: body.status as never } : {}),
      ...(body.priority !== undefined ? { priority: body.priority as never } : {}),
      ...(body.dueAt !== undefined ? { dueAt: body.dueAt } : {}),
    });

    return Response.json({ activity });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}