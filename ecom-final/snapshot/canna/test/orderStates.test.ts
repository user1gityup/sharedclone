import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canTransition,
  requiresVerifiedLicence,
  TERMINAL_ORDER_STATES,
  type OrderState,
} from "../src/lib/orderStates.ts";

test("allows declared transitions and rejects undeclared ones", () => {
  assert.equal(canTransition("draft", "submitted"), true);
  assert.equal(canTransition("draft", "cancelled"), true);
  assert.equal(canTransition("draft", "paid"), false);
  assert.equal(canTransition("submitted", "compliance_pending"), true);
  assert.equal(canTransition("compliance_pending", "awaiting_payment"), true);
  assert.equal(canTransition("compliance_pending", "compliance_failed"), true);
});

test("terminal states have no outgoing transitions", () => {
  assert.ok(TERMINAL_ORDER_STATES.includes("cancelled"));
  assert.ok(TERMINAL_ORDER_STATES.includes("refunded"));
  for (const state of TERMINAL_ORDER_STATES) {
    for (const target of ["draft", "submitted", "paid"] as OrderState[]) {
      assert.equal(canTransition(state, target), false);
    }
  }
});

test("B2B licence gate flags release and fulfilment states", () => {
  assert.equal(requiresVerifiedLicence("compliance_pending"), true);
  assert.equal(requiresVerifiedLicence("awaiting_payment"), true);
  assert.equal(requiresVerifiedLicence("shipped"), true);
  assert.equal(requiresVerifiedLicence("draft"), false);
  assert.equal(requiresVerifiedLicence("submitted"), false);
});
