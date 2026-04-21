"use client";

import { PaginationControls } from "@/components/layout/PaginationControls";
import { usePagination } from "@/hooks/usePagination";
import { useEffect, useState } from "react";

interface CommerceProduct {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  active: boolean;
  checkoutUrl: string | null;
}

interface CommerceOrderLineItem {
  productId?: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

interface CommerceOrder {
  id: string;
  customerName: string | null;
  customerEmail: string | null;
  status: "draft" | "quoted" | "paid" | "cancelled";
  currency: string;
  notes: string | null;
  lineItems: CommerceOrderLineItem[];
  subtotalCents: number;
  totalCents: number;
  createdAt: string;
}

interface CommerceResponse {
  status: {
    mode: "local";
    productCount: number;
    orderCount: number;
  };
  products: CommerceProduct[];
  orders: CommerceOrder[];
}

interface ProductDraft {
  sku: string;
  name: string;
  description: string;
  priceCents: string;
  currency: string;
  active: boolean;
  checkoutUrl: string;
}

interface EditableOrderLineItemDraft {
  productId: string;
  description: string;
  quantity: string;
  unitPriceCents: string;
}

interface EditableOrderDraft {
  customerName: string;
  customerEmail: string;
  status: CommerceOrder["status"];
  currency: string;
  notes: string;
  lineItems: EditableOrderLineItemDraft[];
}

const EMPTY_PRODUCT: ProductDraft = {
  sku: "",
  name: "",
  description: "",
  priceCents: "",
  currency: "USD",
  active: true,
  checkoutUrl: "",
};

const EMPTY_ORDER = {
  customerName: "",
  customerEmail: "",
  status: "draft",
  currency: "USD",
  notes: "",
  description: "",
  quantity: "1",
  unitPriceCents: "",
};

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function createProductDraft(product?: CommerceProduct): ProductDraft {
  if (!product) {
    return { ...EMPTY_PRODUCT };
  }

  return {
    sku: product.sku,
    name: product.name,
    description: product.description ?? "",
    priceCents: String(product.priceCents),
    currency: product.currency,
    active: product.active,
    checkoutUrl: product.checkoutUrl ?? "",
  };
}

function createEditableOrderDraft(order: CommerceOrder): EditableOrderDraft {
  return {
    customerName: order.customerName ?? "",
    customerEmail: order.customerEmail ?? "",
    status: order.status,
    currency: order.currency,
    notes: order.notes ?? "",
    lineItems: order.lineItems.map((line) => ({
      productId: line.productId ?? "",
      description: line.description,
      quantity: String(line.quantity),
      unitPriceCents: String(line.unitPriceCents),
    })),
  };
}

function parseIntegerField(value: string, fieldName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldName} must be a whole number.`);
  }
  return parsed;
}

export default function CommercePage() {
  const [data, setData] = useState<CommerceResponse | null>(null);
  const [productDraft, setProductDraft] = useState<ProductDraft>(EMPTY_PRODUCT);
  const [orderDraft, setOrderDraft] = useState(EMPTY_ORDER);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [editingProductDraft, setEditingProductDraft] = useState<ProductDraft | null>(null);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [editingOrderDraft, setEditingOrderDraft] = useState<EditableOrderDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const productsPagination = usePagination(data?.products ?? [], 15);
  const ordersPagination = usePagination(data?.orders ?? [], 15);

  async function load(): Promise<void> {
    setError(null);
    try {
      const response = await fetch("/api/commerce");
      const payload = (await response.json()) as CommerceResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load commerce workspace.");
      }
      setData(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load commerce workspace.");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function persistProduct(draft: ProductDraft, productId?: string): Promise<void> {
    const priceCents = parseIntegerField(draft.priceCents, "Price cents");

    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/commerce/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(productId ? { productId } : {}),
          sku: draft.sku,
          name: draft.name,
          description: draft.description || undefined,
          priceCents,
          currency: draft.currency,
          active: draft.active,
          checkoutUrl: draft.checkoutUrl || undefined,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to save product.");
      }
      if (productId) {
        setEditingProductId(null);
        setEditingProductDraft(null);
      } else {
        setProductDraft({ ...EMPTY_PRODUCT });
      }
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save product.");
    } finally {
      setSaving(false);
    }
  }

  async function persistOrder(draft: EditableOrderDraft, orderId?: string): Promise<void> {
    const lineItems = draft.lineItems.map((line, index) => ({
      ...(line.productId.trim() ? { productId: line.productId.trim() } : {}),
      description: line.description.trim(),
      quantity: parseIntegerField(line.quantity, `Line ${index + 1} quantity`),
      unitPriceCents: parseIntegerField(line.unitPriceCents, `Line ${index + 1} unit price`),
    }));

    if (lineItems.some((line) => !line.description)) {
      setError("Each order line needs a description.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/commerce/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(orderId ? { orderId } : {}),
          customerName: draft.customerName || undefined,
          customerEmail: draft.customerEmail || undefined,
          status: draft.status,
          currency: draft.currency,
          notes: draft.notes || undefined,
          lineItems,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to save order.");
      }
      if (orderId) {
        setEditingOrderId(null);
        setEditingOrderDraft(null);
      } else {
        setOrderDraft({ ...EMPTY_ORDER });
      }
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save order.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="grid gap-4 grid-cols-4">
        {[
          { label: "mode", value: data?.status.mode ?? "local" },
          { label: "products", value: String(data?.status.productCount ?? 0) },
          { label: "orders", value: String(data?.status.orderCount ?? 0) },
          { label: "latest order", value: data?.orders[0]?.status ?? "none" },
        ].map((card) => (
          <div key={card.label} className="border p-4 border-border bg-surface">
            <div className="text-xs uppercase tracking-[0.24em] mb-2 text-muted">{card.label}</div>
            <div className="text-sm text-primary">{card.value}</div>
          </div>
        ))}
      </section>

      {error ? <div className="text-sm text-danger">{error}</div> : null}

      <section className="grid gap-5 xl:grid-cols-[0.42fr_0.58fr]">
        <section className="space-y-6">
          <section className="border p-4 space-y-3 border-border bg-surface">
            <div>
              <div className="text-xs uppercase tracking-[0.24em] text-muted">product catalog</div>
              <div className="text-sm mt-2 text-dim">Create local SKUs and checkout metadata for sales and content workflows.</div>
            </div>
            <input value={productDraft.sku} onChange={(event) => setProductDraft((current) => ({ ...current, sku: event.target.value }))} placeholder="SKU" className="w-full bg-transparent border px-3 py-2 text-sm border-border" />
            <input value={productDraft.name} onChange={(event) => setProductDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Product name" className="w-full bg-transparent border px-3 py-2 text-sm border-border" />
            <textarea value={productDraft.description} onChange={(event) => setProductDraft((current) => ({ ...current, description: event.target.value }))} placeholder="Description" className="w-full min-h-24 bg-transparent border px-3 py-2 text-sm border-border" />
            <div className="grid gap-3 sm:grid-cols-3">
              <input value={productDraft.priceCents} onChange={(event) => setProductDraft((current) => ({ ...current, priceCents: event.target.value }))} placeholder="Price cents" className="w-full bg-transparent border px-3 py-2 text-sm border-border" />
              <input value={productDraft.currency} onChange={(event) => setProductDraft((current) => ({ ...current, currency: event.target.value.toUpperCase() }))} placeholder="Currency" className="w-full bg-transparent border px-3 py-2 text-sm border-border" />
              <input value={productDraft.checkoutUrl} onChange={(event) => setProductDraft((current) => ({ ...current, checkoutUrl: event.target.value }))} placeholder="Checkout URL" className="w-full bg-transparent border px-3 py-2 text-sm border-border" />
            </div>
            <label className="flex items-center gap-3 border px-3 py-2 text-sm border-border">
              <input type="checkbox" checked={productDraft.active} onChange={(event) => setProductDraft((current) => ({ ...current, active: event.target.checked }))} />
              <span>Active product</span>
            </label>
            <button onClick={() => void persistProduct(productDraft)} disabled={saving || !productDraft.sku || !productDraft.name || !productDraft.priceCents} className="px-4 py-2 border text-xs uppercase tracking-[0.18em] border-accent text-accent"
              style={{ opacity: saving ? 0.6 : 1 }}>
              save product
            </button>
          </section>

          <section className="border p-4 space-y-3 border-border bg-surface">
            <div>
              <div className="text-xs uppercase tracking-[0.24em] text-muted">draft order</div>
              <div className="text-sm mt-2 text-dim">Turn a product or quote into a local order record the agent can work from.</div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <input value={orderDraft.customerName} onChange={(event) => setOrderDraft((current) => ({ ...current, customerName: event.target.value }))} placeholder="Customer name" className="w-full bg-transparent border px-3 py-2 text-sm border-border" />
              <input value={orderDraft.customerEmail} onChange={(event) => setOrderDraft((current) => ({ ...current, customerEmail: event.target.value }))} placeholder="Customer email" className="w-full bg-transparent border px-3 py-2 text-sm border-border" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <select value={orderDraft.status} onChange={(event) => setOrderDraft((current) => ({ ...current, status: event.target.value }))} className="w-full bg-transparent border px-3 py-2 text-sm border-border">
                <option value="draft">draft</option>
                <option value="quoted">quoted</option>
                <option value="paid">paid</option>
                <option value="cancelled">cancelled</option>
              </select>
              <input value={orderDraft.currency} onChange={(event) => setOrderDraft((current) => ({ ...current, currency: event.target.value.toUpperCase() }))} placeholder="Currency" className="w-full bg-transparent border px-3 py-2 text-sm border-border" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <input value={orderDraft.quantity} onChange={(event) => setOrderDraft((current) => ({ ...current, quantity: event.target.value }))} placeholder="Qty" className="w-full bg-transparent border px-3 py-2 text-sm border-border" />
              <input value={orderDraft.unitPriceCents} onChange={(event) => setOrderDraft((current) => ({ ...current, unitPriceCents: event.target.value }))} placeholder="Unit cents" className="w-full bg-transparent border px-3 py-2 text-sm border-border" />
            </div>
            <input value={orderDraft.description} onChange={(event) => setOrderDraft((current) => ({ ...current, description: event.target.value }))} placeholder="Line item description" className="w-full bg-transparent border px-3 py-2 text-sm border-border" />
            <textarea value={orderDraft.notes} onChange={(event) => setOrderDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Order notes" className="w-full min-h-24 bg-transparent border px-3 py-2 text-sm border-border" />
            <button
              onClick={() => void persistOrder({
                customerName: orderDraft.customerName,
                customerEmail: orderDraft.customerEmail,
                status: orderDraft.status as CommerceOrder["status"],
                currency: orderDraft.currency,
                notes: orderDraft.notes,
                lineItems: [
                  {
                    productId: "",
                    description: orderDraft.description,
                    quantity: orderDraft.quantity,
                    unitPriceCents: orderDraft.unitPriceCents,
                  },
                ],
              })}
              disabled={saving || !orderDraft.description || !orderDraft.unitPriceCents}
              className="px-4 py-2 border text-xs uppercase tracking-[0.18em] border-accent text-accent"
              style={{ opacity: saving ? 0.6 : 1 }}
            >
              create order
            </button>
          </section>
        </section>

        <section className="space-y-6">
          <section className="border p-4 border-border bg-surface">
            <div className="text-xs uppercase tracking-[0.24em] mb-4 text-muted">products</div>
            <div className="space-y-3">
              {productsPagination.pageItems.map((product) => {
                const isEditing = editingProductId === product.id && editingProductDraft !== null;
                return (
                  <article key={product.id} className="border p-4 space-y-3 border-border-sub bg-raised">
                    {isEditing ? (
                      <>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <input value={editingProductDraft.sku} onChange={(event) => setEditingProductDraft((current) => current ? { ...current, sku: event.target.value } : current)} placeholder="SKU" className="w-full bg-transparent border px-3 py-2 text-sm border-border" />
                          <input value={editingProductDraft.name} onChange={(event) => setEditingProductDraft((current) => current ? { ...current, name: event.target.value } : current)} placeholder="Name" className="w-full bg-transparent border px-3 py-2 text-sm border-border" />
                        </div>
                        <textarea value={editingProductDraft.description} onChange={(event) => setEditingProductDraft((current) => current ? { ...current, description: event.target.value } : current)} placeholder="Description" className="w-full min-h-24 bg-transparent border px-3 py-2 text-sm border-border" />
                        <div className="grid gap-3 sm:grid-cols-3">
                          <input value={editingProductDraft.priceCents} onChange={(event) => setEditingProductDraft((current) => current ? { ...current, priceCents: event.target.value } : current)} placeholder="Price cents" className="w-full bg-transparent border px-3 py-2 text-sm border-border" />
                          <input value={editingProductDraft.currency} onChange={(event) => setEditingProductDraft((current) => current ? { ...current, currency: event.target.value.toUpperCase() } : current)} placeholder="Currency" className="w-full bg-transparent border px-3 py-2 text-sm border-border" />
                          <input value={editingProductDraft.checkoutUrl} onChange={(event) => setEditingProductDraft((current) => current ? { ...current, checkoutUrl: event.target.value } : current)} placeholder="Checkout URL" className="w-full bg-transparent border px-3 py-2 text-sm border-border" />
                        </div>
                        <label className="flex items-center gap-3 border px-3 py-2 text-sm border-border">
                          <input type="checkbox" checked={editingProductDraft.active} onChange={(event) => setEditingProductDraft((current) => current ? { ...current, active: event.target.checked } : current)} />
                          <span>Active product</span>
                        </label>
                        <div className="flex gap-3">
                          <button onClick={() => void persistProduct(editingProductDraft, product.id)} disabled={saving || !editingProductDraft.sku || !editingProductDraft.name || !editingProductDraft.priceCents} className="px-3 py-2 border text-xs uppercase tracking-[0.18em] border-accent text-accent"
              style={{ opacity: saving ? 0.6 : 1 }}>
                            save
                          </button>
                          <button onClick={() => { setEditingProductId(null); setEditingProductDraft(null); }} className="px-3 py-2 border text-xs uppercase tracking-[0.18em] border-border text-muted">
                            cancel
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <div className="text-sm">{product.name}</div>
                            <div className="text-xs uppercase tracking-[0.16em] text-muted">{product.sku}</div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span>{formatMoney(product.priceCents, product.currency)}</span>
                            <button onClick={() => { setEditingProductId(product.id); setEditingProductDraft(createProductDraft(product)); }} className="px-3 py-2 border text-xs uppercase tracking-[0.18em] border-border text-muted">
                              edit
                            </button>
                          </div>
                        </div>
                        {product.description ? <div className="text-xs leading-6 mt-2 text-dim">{product.description}</div> : null}
                        <div className="flex flex-wrap gap-3 text-xs text-dim">
                          <span>{product.active ? "active" : "inactive"}</span>
                          {product.checkoutUrl ? <span className="text-accent">{product.checkoutUrl}</span> : null}
                        </div>
                      </>
                    )}
                  </article>
                );
              })}
              <PaginationControls {...productsPagination} />
            </div>
          </section>

          <section className="border p-4 border-border bg-surface">
            <div className="text-xs uppercase tracking-[0.24em] mb-4 text-muted">orders</div>
            <div className="space-y-3">
              {ordersPagination.pageItems.map((order) => {
                const isEditing = editingOrderId === order.id && editingOrderDraft !== null;
                return (
                  <article key={order.id} className="border p-4 space-y-3 border-border-sub bg-raised">
                    {isEditing ? (
                      <>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <input value={editingOrderDraft.customerName} onChange={(event) => setEditingOrderDraft((current) => current ? { ...current, customerName: event.target.value } : current)} placeholder="Customer name" className="w-full bg-transparent border px-3 py-2 text-sm border-border" />
                          <input value={editingOrderDraft.customerEmail} onChange={(event) => setEditingOrderDraft((current) => current ? { ...current, customerEmail: event.target.value } : current)} placeholder="Customer email" className="w-full bg-transparent border px-3 py-2 text-sm border-border" />
                        </div>
                        <div className="grid gap-3 sm:grid-cols-3">
                          <select value={editingOrderDraft.status} onChange={(event) => setEditingOrderDraft((current) => current ? { ...current, status: event.target.value as CommerceOrder["status"] } : current)} className="w-full bg-transparent border px-3 py-2 text-sm border-border">
                            <option value="draft">draft</option>
                            <option value="quoted">quoted</option>
                            <option value="paid">paid</option>
                            <option value="cancelled">cancelled</option>
                          </select>
                          <input value={editingOrderDraft.currency} onChange={(event) => setEditingOrderDraft((current) => current ? { ...current, currency: event.target.value.toUpperCase() } : current)} placeholder="Currency" className="w-full bg-transparent border px-3 py-2 text-sm border-border" />
                        </div>
                        <div className="space-y-3">
                          {editingOrderDraft.lineItems.map((line, index) => (
                            <div key={`${order.id}-${index}`} className="grid gap-3 border p-3 sm:grid-cols-3 border-border bg-surface">
                              <input value={line.description} onChange={(event) => setEditingOrderDraft((current) => current ? { ...current, lineItems: current.lineItems.map((entry, entryIndex) => entryIndex === index ? { ...entry, description: event.target.value } : entry) } : current)} placeholder="Description" className="w-full bg-transparent border px-3 py-2 text-sm sm:col-span-3 border-border-sub" />
                              <input value={line.quantity} onChange={(event) => setEditingOrderDraft((current) => current ? { ...current, lineItems: current.lineItems.map((entry, entryIndex) => entryIndex === index ? { ...entry, quantity: event.target.value } : entry) } : current)} placeholder="Qty" className="w-full bg-transparent border px-3 py-2 text-sm border-border-sub" />
                              <input value={line.unitPriceCents} onChange={(event) => setEditingOrderDraft((current) => current ? { ...current, lineItems: current.lineItems.map((entry, entryIndex) => entryIndex === index ? { ...entry, unitPriceCents: event.target.value } : entry) } : current)} placeholder="Unit cents" className="w-full bg-transparent border px-3 py-2 text-sm border-border-sub" />
                              <div className="flex items-center text-xs text-dim">
                                total {formatMoney((Number.parseInt(line.quantity, 10) || 0) * (Number.parseInt(line.unitPriceCents, 10) || 0), editingOrderDraft.currency)}
                              </div>
                            </div>
                          ))}
                        </div>
                        <textarea value={editingOrderDraft.notes} onChange={(event) => setEditingOrderDraft((current) => current ? { ...current, notes: event.target.value } : current)} placeholder="Order notes" className="w-full min-h-24 bg-transparent border px-3 py-2 text-sm border-border" />
                        <div className="flex gap-3">
                          <button onClick={() => void persistOrder(editingOrderDraft, order.id)} disabled={saving || editingOrderDraft.lineItems.some((line) => !line.description || !line.unitPriceCents)} className="px-3 py-2 border text-xs uppercase tracking-[0.18em] border-accent text-accent"
              style={{ opacity: saving ? 0.6 : 1 }}>
                            save
                          </button>
                          <button onClick={() => { setEditingOrderId(null); setEditingOrderDraft(null); }} className="px-3 py-2 border text-xs uppercase tracking-[0.18em] border-border text-muted">
                            cancel
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <div className="text-sm">{order.customerName ?? order.customerEmail ?? order.id}</div>
                            <div className="text-xs uppercase tracking-[0.16em] text-muted">{order.status}</div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span>{formatMoney(order.totalCents, order.currency)}</span>
                            <button onClick={() => { setEditingOrderId(order.id); setEditingOrderDraft(createEditableOrderDraft(order)); }} className="px-3 py-2 border text-xs uppercase tracking-[0.18em] border-border text-muted">
                              edit
                            </button>
                          </div>
                        </div>
                        <div className="space-y-2 text-xs text-dim">
                          {order.lineItems.map((line, index) => (
                            <div key={`${order.id}-${index}`} className="flex items-center justify-between gap-4">
                              <span>{line.quantity} × {line.description}</span>
                              <span>{formatMoney(line.lineTotalCents, order.currency)}</span>
                            </div>
                          ))}
                        </div>
                        {order.notes ? <div className="text-xs leading-6 text-dim">{order.notes}</div> : null}
                      </>
                    )}
                  </article>
                );
              })}
              <PaginationControls {...ordersPagination} />
            </div>
          </section>
        </section>
      </section>
    </div>
  );
}