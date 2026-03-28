import { NextRequest } from "next/server";
import {
  createCrmContactFromInbox,
  getActiveCrmProvider,
  getCrmProviderStatuses,
  listCrmContacts,
  upsertCrmContact,
} from "@/lib/crm";

export async function GET(req: NextRequest) {
  const stage = req.nextUrl.searchParams.get("stage") ?? undefined;
  const query = req.nextUrl.searchParams.get("query") ?? undefined;
  const limit = Number.parseInt(req.nextUrl.searchParams.get("limit") ?? "25", 10);

  const [contacts, providers] = await Promise.all([
    listCrmContacts({
      ...(stage ? { stage: stage as never } : {}),
      ...(query ? { query } : {}),
      limit: Number.isFinite(limit) ? limit : 25,
    }),
    getCrmProviderStatuses(),
  ]);

  return Response.json({
    activeProvider: getActiveCrmProvider(),
    providers,
    contacts,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      inboxMessageId?: string;
      stage?: string;
      score?: number;
      summary?: string;
    };

    if (!body.inboxMessageId) {
      return Response.json({ error: "inboxMessageId is required." }, { status: 400 });
    }

    const contact = await createCrmContactFromInbox({
      inboxMessageId: body.inboxMessageId,
      ...(body.stage ? { stage: body.stage as never } : {}),
      ...(typeof body.score === "number" ? { score: body.score } : {}),
      ...(typeof body.summary === "string" ? { summary: body.summary } : {}),
    });

    return Response.json({ contact }, { status: 201 });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      contactId?: string;
      stage?: string;
      score?: number;
      summary?: string | null;
    };

    if (!body.contactId) {
      return Response.json({ error: "contactId is required." }, { status: 400 });
    }

    const contact = await upsertCrmContact({
      contactId: body.contactId,
      ...(body.stage ? { stage: body.stage as never } : {}),
      ...(typeof body.score === "number" ? { score: body.score } : {}),
      ...(typeof body.summary === "string" || body.summary === null ? { summary: body.summary } : {}),
    });

    return Response.json({ contact });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}