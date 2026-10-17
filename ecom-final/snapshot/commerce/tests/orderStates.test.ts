import { describe, it } from "node:test";
import assert from "node:assert";

import { ORDER_TRANSITIONS, canTransition, TERMINAL_ORDER_STATES, RAIL_IS_ASYNC } from "../src/lib/orderStates.ts";

describe("orderStates", () => {
  it("allows draft -> awaiting_payment", () => {
    assert.strictEqual(canTransition("draft", "awaiting_payment"), true);
  });

  it("allows draft -> cancelled", () => {
    assert.strictEqual(canTransition("draft", "cancelled"), true);
  });

  it("disallows draft -> paid", () => {
    assert.strictEqual(canTransition("draft", "paid"), false);
  });

  it("paid -> fulfilled allowed", () => {
    assert.strictEqual(canTransition("paid", "fulfilled"), true);
  });

  it("paid -> partially_refunded allowed", () => {
    assert.strictEqual(canTransition("paid", "partially_refunded"), true);
  });

  it("cancelled is terminal", () => {
    assert.strictEqual(canTransition("cancelled", "draft"), false);
    assert.ok(TERMINAL_ORDER_STATES.includes("cancelled"));
  });

  it("refunded is terminal", () => {
    assert.ok(TERMINAL_ORDER_STATES.includes("refunded"));
  });

  it("ORDER_TRANSITIONS is frozen", () => {
    assert.throws(() => {
      (ORDER_TRANSITIONS as any).draft = [];
    }, TypeError);
  });

  it("RAIL_IS_ASYNC has all four rails", () => {
    assert.strictEqual(RAIL_IS_ASYNC.stripe, true);
    assert.strictEqual(RAIL_IS_ASYNC.stripe_connect, true);
    assert.strictEqual(RAIL_IS_ASYNC.solana_devnet, true);
    assert.strictEqual(RAIL_IS_ASYNC.manual_crypto, true);
  });
});
