import { describe, it } from "node:test";
import assert from "node:assert";

import {
  FIXED_NOW,
  STRIPE_PAYMENT_INTENT_SUCCEEDED,
  STRIPE_DUPLICATE_DELIVERY,
  STRIPE_OUT_OF_ORDER_REFUND,
  STRIPE_UNKNOWN_ORDER,
} from "./fixtures/webhooks.ts";

describe("webhook fixtures", () => {
  it("FIXED_NOW is a number", () => {
    assert.strictEqual(typeof FIXED_NOW, "number");
  });

  it("STRIPE_PAYMENT_INTENT_SUCCEEDED has expected shape", () => {
    assert.strictEqual(STRIPE_PAYMENT_INTENT_SUCCEEDED.type, "payment_intent.succeeded");
    assert.strictEqual(STRIPE_PAYMENT_INTENT_SUCCEEDED.data.object.metadata.orderId, "ord_test_001");
  });

  it("STRIPE_DUPLICATE_DELIVERY is byte-identical to the success event", () => {
    assert.deepStrictEqual(STRIPE_DUPLICATE_DELIVERY, STRIPE_PAYMENT_INTENT_SUCCEEDED);
  });

  it("STRIPE_OUT_OF_ORDER_REFUND has earlier created time", () => {
    assert.ok(STRIPE_OUT_OF_ORDER_REFUND.created < STRIPE_PAYMENT_INTENT_SUCCEEDED.created);
  });

  it("STRIPE_UNKNOWN_ORDER has a non-existent orderId", () => {
    assert.strictEqual(STRIPE_UNKNOWN_ORDER.data.object.metadata.orderId, "ord_nonexistent_999");
  });
});
