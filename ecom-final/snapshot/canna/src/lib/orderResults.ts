// In-memory store of the most recent checkout results, keyed by order ref.
// The zero-credential demo path uses this to render the order-confirmation page.

import type { CheckoutResult } from "@/lib/checkoutService";

const results = new Map<string, CheckoutResult>();

export function saveOrderResult(result: CheckoutResult): void {
  results.set(result.orderRef, result);
}

export function getOrderResult(ref: string): CheckoutResult | undefined {
  return results.get(ref);
}
