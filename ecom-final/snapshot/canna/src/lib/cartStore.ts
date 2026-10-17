// In-memory cart store, keyed by an opaque cart id (carried in a cookie).
// Zero-credential, zero-database path so the storefront is clickable locally.

import { getVariant, type DemoVariant } from "@/lib/catalog";
import { addMinor } from "@/lib/units";

export interface CartLineItem {
  variant: DemoVariant;
  quantity: number;
  lineTotalCents: number;
}

export interface CartView {
  lines: CartLineItem[];
  totalCents: number;
  itemCount: number;
}

const carts = new Map<string, Map<string, number>>();

/** Add (or merge) a SKU quantity into a cart. */
export function addToCart(cartId: string, sku: string, quantity: number): void {
  const variant = getVariant(sku);
  if (!variant) throw new Error(`unknown sku: ${sku}`);
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error("quantity must be a positive integer");
  const cart = carts.get(cartId) ?? new Map<string, number>();
  cart.set(sku, (cart.get(sku) ?? 0) + quantity);
  carts.set(cartId, cart);
}

/** Read a cart as a rendered view with line and order totals. */
export function getCart(cartId: string): CartView {
  const cart = carts.get(cartId);
  if (!cart) return { lines: [], totalCents: 0, itemCount: 0 };

  const lines: CartLineItem[] = [];
  for (const [sku, quantity] of cart.entries()) {
    const variant = getVariant(sku);
    if (!variant) continue;
    lines.push({ variant, quantity, lineTotalCents: quantity * variant.priceCents });
  }
  const totalCents = lines.reduce((acc, l) => addMinor(acc, l.lineTotalCents), 0);
  const itemCount = lines.reduce((acc, l) => acc + l.quantity, 0);
  return { lines, totalCents, itemCount };
}

/** Remove a cart entirely. */
export function clearCart(cartId: string): void {
  carts.delete(cartId);
}
