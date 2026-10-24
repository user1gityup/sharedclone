/** All possible order states. */
export type OrderState =
  | "draft"
  | "awaiting_payment"
  | "payment_processing"
  | "paid"
  | "partially_fulfilled"
  | "fulfilled"
  | "cancelled"
  | "refunded"
  | "partially_refunded";

/** Allowed next states for each order state. */
export const ORDER_TRANSITIONS: Readonly<Record<OrderState, readonly OrderState[]>> = Object.freeze({
  draft: ["awaiting_payment", "cancelled"],
  awaiting_payment: ["payment_processing", "cancelled"],
  payment_processing: ["paid", "awaiting_payment", "cancelled"],
  paid: ["partially_fulfilled", "fulfilled", "refunded", "partially_refunded"],
  partially_fulfilled: ["fulfilled", "partially_refunded", "refunded"],
  fulfilled: ["refunded", "partially_refunded"],
  cancelled: [],
  refunded: [],
  partially_refunded: ["refunded"],
});

/** Returns true when the transition from one state to another is allowed. */
export function canTransition(from: OrderState, to: OrderState): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/** States from which no further transitions are allowed. */
export const TERMINAL_ORDER_STATES: readonly OrderState[] = Object.freeze(["cancelled", "refunded"]);

/** Supported payment rails. */
export type PaymentRail = "stripe" | "stripe_connect" | "solana_devnet" | "manual_crypto";

/** Which payment rails settle asynchronously (via webhook or chain confirmation). */
export const RAIL_IS_ASYNC: Readonly<Record<PaymentRail, boolean>> = Object.freeze({
  stripe: true,
  stripe_connect: true,
  solana_devnet: true,
  manual_crypto: true,
});
