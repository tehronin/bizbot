import { NextRequest } from "next/server";
import { listCommerceProducts, upsertCommerceProduct } from "@/lib/commerce";

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("query") ?? undefined;
  const active = req.nextUrl.searchParams.get("active");
  const limit = Number.parseInt(req.nextUrl.searchParams.get("limit") ?? "50", 10);
  const products = await listCommerceProducts({
    ...(query ? { query } : {}),
    ...(active === "true" ? { active: true } : active === "false" ? { active: false } : {}),
    limit: Number.isFinite(limit) ? limit : 50,
  });
  return Response.json({ products });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      productId?: string;
      sku?: string;
      name?: string;
      description?: string;
      priceCents?: number;
      currency?: string;
      active?: boolean;
      checkoutUrl?: string;
    };

    if (!body.sku || !body.name || typeof body.priceCents !== "number") {
      return Response.json({ error: "sku, name, and priceCents are required." }, { status: 400 });
    }

    const product = await upsertCommerceProduct({
      productId: body.productId,
      sku: body.sku,
      name: body.name,
      description: body.description,
      priceCents: body.priceCents,
      currency: body.currency,
      active: body.active,
      checkoutUrl: body.checkoutUrl,
    });

    return Response.json({ product }, { status: 201 });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}