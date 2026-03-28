import { NextRequest } from "next/server";
import { listCommerceOrders, upsertCommerceOrder } from "@/lib/commerce";

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status") ?? undefined;
  const limit = Number.parseInt(req.nextUrl.searchParams.get("limit") ?? "50", 10);
  const orders = await listCommerceOrders({
    ...(status ? { status: status as never } : {}),
    limit: Number.isFinite(limit) ? limit : 50,
  });
  return Response.json({ orders });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      orderId?: string;
      customerName?: string;
      customerEmail?: string;
      status?: string;
      currency?: string;
      notes?: string;
      lineItems?: Array<{
        productId?: string;
        description: string;
        quantity: number;
        unitPriceCents: number;
      }>;
    };

    if (!Array.isArray(body.lineItems) || body.lineItems.length === 0) {
      return Response.json({ error: "At least one line item is required." }, { status: 400 });
    }

    const order = await upsertCommerceOrder({
      orderId: body.orderId,
      customerName: body.customerName,
      customerEmail: body.customerEmail,
      status: body.status as never,
      currency: body.currency,
      notes: body.notes,
      lineItems: body.lineItems,
    });

    return Response.json({ order }, { status: body.orderId ? 200 : 201 });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}