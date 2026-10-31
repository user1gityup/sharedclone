// Order and compliance state tables. Constants and pure helpers only.

export type OrderState =
  | "draft"
  | "submitted"
  | "compliance_pending"
  | "compliance_failed"
  | "awaiting_payment"
  | "paid"
  | "fulfilling"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "refunded";

export const ORDER_TRANSITIONS: Readonly<Record<OrderState, readonly OrderState[]>> = {
  draft: ["submitted", "cancelled"],
  submitted: ["compliance_pending", "cancelled"],
  compliance_pending: ["compliance_failed", "awaiting_payment"],
  compliance_failed: ["submitted", "cancelled"],
  awaiting_payment: ["paid", "cancelled"],
  paid: ["fulfilling", "refunded"],
  fulfilling: ["shipped", "refunded"],
  shipped: ["delivered"],
  delivered: ["refunded"],
  cancelled: [],
  refunded: [],
};

export const TERMINAL_ORDER_STATES: readonly OrderState[] = Object.freeze(["cancelled", "refunded"]);

/**
 * True when `from` may transition to `to` per ORDER_TRANSITIONS.
 */
export function canTransition(from: OrderState, to: OrderState): boolean {
  return ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * States that must not be entered while the buyer's licence verification status
 * is anything other than "verified" (B2B wholesale gate).
 */
export const B2B_REQUIRES_LICENCE: readonly OrderState[] = Object.freeze([
  "compliance_pending",
  "awaiting_payment",
  "paid",
  "fulfilling",
  "shipped",
  "delivered",
]);

/** True when the given state may not be entered without a verified licence. */
export function requiresVerifiedLicence(state: OrderState): boolean {
  return B2B_REQUIRES_LICENCE.includes(state);
}
