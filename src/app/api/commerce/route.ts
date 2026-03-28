import { getCommerceStatus, listCommerceOrders, listCommerceProducts } from "@/lib/commerce";

export async function GET() {
  const [status, products, orders] = await Promise.all([
    getCommerceStatus(),
    listCommerceProducts({ limit: 25 }),
    listCommerceOrders({ limit: 25 }),
  ]);

  return Response.json({ status, products, orders });
}