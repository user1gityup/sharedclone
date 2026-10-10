// Fixed epoch-seconds timestamp used for all fixtures.
export const FIXED_NOW = 1700000000;

// A successful Stripe payment_intent.succeeded event.
export const STRIPE_PAYMENT_INTENT_SUCCEEDED = {
  id: "evt_test_001",
  type: "payment_intent.succeeded" as const,
  created: FIXED_NOW,
  data: {
    object: {
      id: "pi_test_001",
      amount: 5000,
      currency: "usd",
      metadata: { orderId: "ord_test_001" },
    },
  },
};

// Byte-identical duplicate delivery of the same event — proves idempotency.
export const STRIPE_DUPLICATE_DELIVERY = {
  id: "evt_test_001",
  type: "payment_intent.succeeded" as const,
  created: FIXED_NOW,
  data: {
    object: {
      id: "pi_test_001",
      amount: 5000,
      currency: "usd",
      metadata: { orderId: "ord_test_001" },
    },
  },
};

// A refund event with created timestamp EARLIER than the success event — tests out-of-order delivery.
export const STRIPE_OUT_OF_ORDER_REFUND = {
  id: "evt_test_002",
  type: "charge.refunded" as const,
  created: FIXED_NOW - 60,
  data: {
    object: {
      id: "ch_test_001",
      amount: 5000,
      currency: "usd",
      metadata: { orderId: "ord_test_001" },
    },
  },
};

// A webhook event referencing an order that does not exist.
export const STRIPE_UNKNOWN_ORDER = {
  id: "evt_test_003",
  type: "payment_intent.succeeded" as const,
  created: FIXED_NOW,
  data: {
    object: {
      id: "pi_test_003",
      amount: 5000,
      currency: "usd",
      // Unique: metadata.orderId names a non-existent order.
      metadata: { orderId: "ord_nonexistent_999" },
    },
  },
};

// A Solana transaction confirmation event.
export const SOLANA_CONFIRMATION = {
  // Unique: signature links this to a payment request.
  signature: "5SigPublicKeyBase58EncodedStringHereABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890",
  slot: 200_000_000,
  confirmations: 32,
  orderId: "ord_test_001",
  lamports: 5_000_000,
};

// A Solana reorg replay of the same signature at a different slot.
export const SOLANA_REORG_REPLAY = {
  // Unique: same signature, different slot.
  signature: "5SigPublicKeyBase58EncodedStringHereABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890",
  slot: 199_999_999,
  confirmations: 1,
  orderId: "ord_test_001",
  lamports: 5_000_000,
};
