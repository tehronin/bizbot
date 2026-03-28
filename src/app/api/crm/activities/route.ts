import { NextRequest } from "next/server";
import {
  createCrmContactActivity,
  listCrmContactActivities,
} from "@/lib/crm";

export async function GET(req: NextRequest) {
  const contactId = req.nextUrl.searchParams.get("contactId") ?? undefined;
  const type = req.nextUrl.searchParams.get("type") ?? undefined;
  const status = req.nextUrl.searchParams.get("status") ?? undefined;
  const query = req.nextUrl.searchParams.get("query") ?? undefined;
  const limit = Number.parseInt(req.nextUrl.searchParams.get("limit") ?? "50", 10);

  const activities = await listCrmContactActivities({
    ...(contactId ? { contactId } : {}),
    ...(type ? { type: type as never } : {}),
    ...(status ? { status: status as never } : {}),
    ...(query ? { query } : {}),
    limit: Number.isFinite(limit) ? limit : 50,
  });

  return Response.json({ activities });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      contactId?: string;
      type?: string;
      title?: string;
      subject?: string;
      body?: string;
      status?: string;
      priority?: string;
      dueAt?: string;
    };

    if (!body.contactId || !body.type || !body.body) {
      return Response.json({ error: "contactId, type, and body are required." }, { status: 400 });
    }

    const activity = await createCrmContactActivity({
      contactId: body.contactId,
      type: body.type as never,
      title: body.title,
      subject: body.subject,
      body: body.body,
      ...(body.status ? { status: body.status as never } : {}),
      ...(body.priority ? { priority: body.priority as never } : {}),
      ...(body.dueAt ? { dueAt: body.dueAt } : {}),
    });

    return Response.json({ activity }, { status: 201 });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}