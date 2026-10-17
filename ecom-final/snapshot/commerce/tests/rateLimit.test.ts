import { describe, it } from "node:test";
import assert from "node:assert";

import { checkRateLimit } from "../src/lib/rateLimit.ts";

describe("rateLimit", () => {
  it("allows requests within budget", () => {
    for (let i = 0; i < 5; i++) {
      const { allowed } = checkRateLimit("test-key", 1000000, 10);
      assert.strictEqual(allowed, true);
    }
  });

  it("denies requests over budget", () => {
    // Fill the bucket first
    for (let i = 0; i < 10; i++) {
      checkRateLimit("test-key-2", 1000000, 10);
    }
    const { allowed } = checkRateLimit("test-key-2", 1000000, 10);
    assert.strictEqual(allowed, false);
  });

  it("resets after window", () => {
    checkRateLimit("test-key-3", 1000000, 5);
    checkRateLimit("test-key-3", 1000000, 5);
    // Simulate 61 seconds later
    const { allowed } = checkRateLimit("test-key-3", 1000000 + 61_000, 5);
    assert.strictEqual(allowed, true);
  });
});
