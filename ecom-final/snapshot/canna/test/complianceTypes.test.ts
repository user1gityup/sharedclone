import { test } from "node:test";
import assert from "node:assert/strict";
import { licenceBlocksOrdering, LICENCE_TERMINAL_STATUSES } from "../src/types/compliance.ts";

test("expired and revoked licences block ordering", () => {
  assert.ok(LICENCE_TERMINAL_STATUSES.includes("expired"));
  assert.ok(LICENCE_TERMINAL_STATUSES.includes("revoked"));
  assert.equal(licenceBlocksOrdering("expired"), true);
  assert.equal(licenceBlocksOrdering("revoked"), true);
});

test("verified, pending and unverified do not count as terminal", () => {
  assert.equal(licenceBlocksOrdering("verified"), false);
  assert.equal(licenceBlocksOrdering("pending"), false);
  assert.equal(licenceBlocksOrdering("unverified"), false);
});
