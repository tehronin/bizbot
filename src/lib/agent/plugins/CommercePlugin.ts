/** CommercePlugin — Local-first product and order operations for revenue workflows. */

import {
  createCommerceOrder,
  getCommerceStatus,
  listCommerceOrders,
  listCommerceProducts,
  upsertCommerceProduct,
  type CommerceOrderLineItemInput,
  type CommerceOrderStatus,
} from "@/lib/commerce";
import { defineTool, registerTool, type ToolDefinition } from "@/lib/agent/tools";

interface CommerceStatusArgs {
  _: never;
}

interface CommerceListProductsArgs {
  active?: boolean;
  query?: string;
  limit?: number;
}

interface CommerceUpsertProductArgs {
  productId?: string;
  sku: string;
  name: string;
  description?: string;
  priceCents: number;
  currency?: string;
  active?: boolean;
  checkoutUrl?: string;
}

interface CommerceListOrdersArgs {
  status?: CommerceOrderStatus;
  limit?: number;
}

interface CommerceCreateOrderArgs {
  customerName?: string;
  customerEmail?: string;
  status?: CommerceOrderStatus;
  currency?: string;
  notes?: string;
  lineItems: CommerceOrderLineItemInput[];
}

export const commercePlugin = {
  tools: [
    registerTool(defineTool({
      name: "commerce_get_status",
      description: "Inspect the local commerce catalog and order pipeline status.",
      parameters: { type: "object", properties: {} },
      execute: async () => ({
        commerce: await getCommerceStatus(),
      }),
    } satisfies ToolDefinition<CommerceStatusArgs, { commerce: Awaited<ReturnType<typeof getCommerceStatus>> }>)),
    registerTool(defineTool({
      name: "commerce_list_products",
      description: "List locally managed products and offer records for sales workflows.",
      parameters: {
        type: "object",
        properties: {
          active: { type: "boolean" },
          query: { type: "string" },
          limit: { type: "number", default: 25 },
        },
      },
      execute: async ({ active, query, limit }: CommerceListProductsArgs) => ({
        products: await listCommerceProducts({ active, query, limit: limit ?? 25 }),
      }),
    } satisfies ToolDefinition<CommerceListProductsArgs, { products: Awaited<ReturnType<typeof listCommerceProducts>> }>)),
    registerTool(defineTool({
      name: "commerce_upsert_product",
      description: "Create or update a local commerce product with pricing and checkout metadata.",
      parameters: {
        type: "object",
        properties: {
          productId: { type: "string" },
          sku: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          priceCents: { type: "number" },
          currency: { type: "string" },
          active: { type: "boolean" },
          checkoutUrl: { type: "string" },
        },
        required: ["sku", "name", "priceCents"],
      },
      execute: async (args: CommerceUpsertProductArgs) => ({
        product: await upsertCommerceProduct(args),
      }),
    } satisfies ToolDefinition<CommerceUpsertProductArgs, { product: Awaited<ReturnType<typeof upsertCommerceProduct>> }>)),
    registerTool(defineTool({
      name: "commerce_list_orders",
      description: "List local commerce orders and quotes by status.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["draft", "quoted", "paid", "cancelled"] },
          limit: { type: "number", default: 25 },
        },
      },
      execute: async ({ status, limit }: CommerceListOrdersArgs) => ({
        orders: await listCommerceOrders({ status, limit: limit ?? 25 }),
      }),
    } satisfies ToolDefinition<CommerceListOrdersArgs, { orders: Awaited<ReturnType<typeof listCommerceOrders>> }>)),
    registerTool(defineTool({
      name: "commerce_create_order",
      description: "Create a local draft order or quote with line items and customer info.",
      parameters: {
        type: "object",
        properties: {
          customerName: { type: "string" },
          customerEmail: { type: "string" },
          status: { type: "string", enum: ["draft", "quoted", "paid", "cancelled"] },
          currency: { type: "string" },
          notes: { type: "string" },
          lineItems: {
            type: "array",
            items: {
              type: "object",
              properties: {
                productId: { type: "string" },
                description: { type: "string" },
                quantity: { type: "number" },
                unitPriceCents: { type: "number" },
              },
              required: ["description", "quantity", "unitPriceCents"],
            },
          },
        },
        required: ["lineItems"],
      },
      execute: async ({ customerName, customerEmail, status, currency, notes, lineItems }: CommerceCreateOrderArgs) => ({
        order: await createCommerceOrder({
          customerName,
          customerEmail,
          status,
          currency,
          notes,
          lineItems,
        }),
      }),
    } satisfies ToolDefinition<CommerceCreateOrderArgs, { order: Awaited<ReturnType<typeof createCommerceOrder>> }>)),
  ],
};