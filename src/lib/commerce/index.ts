import crypto from "node:crypto";
import { db } from "@/lib/db";

const COMMERCE_PRODUCT_KEY_PREFIX = "commerce_product:";
const COMMERCE_ORDER_KEY_PREFIX = "commerce_order:";

export type CommerceOrderStatus = "draft" | "quoted" | "paid" | "cancelled";

export interface CommerceProduct {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  active: boolean;
  checkoutUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CommerceOrderLineItemInput {
  productId?: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
}

export interface CommerceOrderLineItem extends CommerceOrderLineItemInput {
  lineTotalCents: number;
}

export interface CommerceOrder {
  id: string;
  customerName: string | null;
  customerEmail: string | null;
  status: CommerceOrderStatus;
  currency: string;
  notes: string | null;
  lineItems: CommerceOrderLineItem[];
  subtotalCents: number;
  totalCents: number;
  createdAt: string;
  updatedAt: string;
}

function parseStoredRecord<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function productKey(productId: string): string {
  return `${COMMERCE_PRODUCT_KEY_PREFIX}${productId}`;
}

function orderKey(orderId: string): string {
  return `${COMMERCE_ORDER_KEY_PREFIX}${orderId}`;
}

export async function getCommerceStatus(): Promise<{
  mode: "local";
  productCount: number;
  orderCount: number;
}> {
  const [productCount, orderCount] = await Promise.all([
    db.setting.count({ where: { key: { startsWith: COMMERCE_PRODUCT_KEY_PREFIX } } }),
    db.setting.count({ where: { key: { startsWith: COMMERCE_ORDER_KEY_PREFIX } } }),
  ]);

  return {
    mode: "local",
    productCount,
    orderCount,
  };
}

export async function listCommerceProducts(filters?: {
  active?: boolean;
  query?: string;
  limit?: number;
}): Promise<CommerceProduct[]> {
  const limit = Math.min(Math.max(filters?.limit ?? 25, 1), 100);
  const query = filters?.query?.trim().toLowerCase();
  const records = await db.setting.findMany({
    where: { key: { startsWith: COMMERCE_PRODUCT_KEY_PREFIX } },
    orderBy: { updatedAt: "desc" },
    take: Math.max(limit * 3, limit),
  });

  return records
    .flatMap((record) => {
      const parsed = parseStoredRecord<CommerceProduct>(record.value);
      return parsed ? [parsed] : [];
    })
    .filter((product) => {
      if (filters?.active !== undefined && product.active !== filters.active) {
        return false;
      }
      if (!query) {
        return true;
      }
      return [product.sku, product.name, product.description]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(query));
    })
    .slice(0, limit);
}

export async function upsertCommerceProduct(input: {
  productId?: string;
  sku: string;
  name: string;
  description?: string;
  priceCents: number;
  currency?: string;
  active?: boolean;
  checkoutUrl?: string;
}): Promise<CommerceProduct> {
  const now = new Date().toISOString();
  const existing = input.productId
    ? await db.setting.findUnique({ where: { key: productKey(input.productId) }, select: { value: true } })
    : null;
  const parsedExisting = existing ? parseStoredRecord<CommerceProduct>(existing.value) : null;
  const product: CommerceProduct = {
    id: input.productId ?? crypto.randomUUID(),
    sku: input.sku,
    name: input.name,
    description: input.description ?? null,
    priceCents: Math.max(0, Math.trunc(input.priceCents)),
    currency: (input.currency ?? parsedExisting?.currency ?? "USD").toUpperCase(),
    active: input.active ?? parsedExisting?.active ?? true,
    checkoutUrl: input.checkoutUrl ?? parsedExisting?.checkoutUrl ?? null,
    createdAt: parsedExisting?.createdAt ?? now,
    updatedAt: now,
  };

  await db.setting.upsert({
    where: { key: productKey(product.id) },
    update: { value: JSON.stringify(product) },
    create: { key: productKey(product.id), value: JSON.stringify(product) },
  });

  return product;
}

function normalizeLineItem(input: CommerceOrderLineItemInput): CommerceOrderLineItem {
  const quantity = Math.max(1, Math.trunc(input.quantity));
  const unitPriceCents = Math.max(0, Math.trunc(input.unitPriceCents));
  return {
    productId: input.productId,
    description: input.description,
    quantity,
    unitPriceCents,
    lineTotalCents: quantity * unitPriceCents,
  };
}

export async function listCommerceOrders(filters?: {
  status?: CommerceOrderStatus;
  limit?: number;
}): Promise<CommerceOrder[]> {
  const limit = Math.min(Math.max(filters?.limit ?? 25, 1), 100);
  const records = await db.setting.findMany({
    where: { key: { startsWith: COMMERCE_ORDER_KEY_PREFIX } },
    orderBy: { updatedAt: "desc" },
    take: Math.max(limit * 3, limit),
  });

  return records
    .flatMap((record) => {
      const parsed = parseStoredRecord<CommerceOrder>(record.value);
      return parsed ? [parsed] : [];
    })
    .filter((order) => (filters?.status ? order.status === filters.status : true))
    .slice(0, limit);
}

export async function createCommerceOrder(input: {
  customerName?: string;
  customerEmail?: string;
  status?: CommerceOrderStatus;
  currency?: string;
  notes?: string;
  lineItems: CommerceOrderLineItemInput[];
}): Promise<CommerceOrder> {
  if (input.lineItems.length === 0) {
    throw new Error("Commerce order requires at least one line item.");
  }

  const normalized = input.lineItems.map(normalizeLineItem);
  const subtotalCents = normalized.reduce((sum, item) => sum + item.lineTotalCents, 0);
  const now = new Date().toISOString();
  const order: CommerceOrder = {
    id: crypto.randomUUID(),
    customerName: input.customerName ?? null,
    customerEmail: input.customerEmail ?? null,
    status: input.status ?? "draft",
    currency: (input.currency ?? "USD").toUpperCase(),
    notes: input.notes ?? null,
    lineItems: normalized,
    subtotalCents,
    totalCents: subtotalCents,
    createdAt: now,
    updatedAt: now,
  };

  await db.setting.create({
    data: { key: orderKey(order.id), value: JSON.stringify(order) },
  });

  return order;
}

export async function upsertCommerceOrder(input: {
  orderId?: string;
  customerName?: string;
  customerEmail?: string;
  status?: CommerceOrderStatus;
  currency?: string;
  notes?: string;
  lineItems: CommerceOrderLineItemInput[];
}): Promise<CommerceOrder> {
  if (input.lineItems.length === 0) {
    throw new Error("Commerce order requires at least one line item.");
  }

  const existing = input.orderId
    ? await db.setting.findUnique({ where: { key: orderKey(input.orderId) }, select: { value: true } })
    : null;
  const parsedExisting = existing ? parseStoredRecord<CommerceOrder>(existing.value) : null;
  const normalized = input.lineItems.map(normalizeLineItem);
  const subtotalCents = normalized.reduce((sum, item) => sum + item.lineTotalCents, 0);
  const now = new Date().toISOString();
  const order: CommerceOrder = {
    id: input.orderId ?? crypto.randomUUID(),
    customerName: input.customerName ?? parsedExisting?.customerName ?? null,
    customerEmail: input.customerEmail ?? parsedExisting?.customerEmail ?? null,
    status: input.status ?? parsedExisting?.status ?? "draft",
    currency: (input.currency ?? parsedExisting?.currency ?? "USD").toUpperCase(),
    notes: input.notes ?? parsedExisting?.notes ?? null,
    lineItems: normalized,
    subtotalCents,
    totalCents: subtotalCents,
    createdAt: parsedExisting?.createdAt ?? now,
    updatedAt: now,
  };

  await db.setting.upsert({
    where: { key: orderKey(order.id) },
    update: { value: JSON.stringify(order) },
    create: { key: orderKey(order.id), value: JSON.stringify(order) },
  });

  return order;
}