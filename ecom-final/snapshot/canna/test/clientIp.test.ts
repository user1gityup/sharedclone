import { test } from "node:test";
import assert from "node:assert/strict";
import { clientIpFor } from "../src/lib/clientIp.ts";

function req(xff: string | null) {
  return { headers: { get: (name: string) => (name === "x-forwarded-for" ? xff : null) } };
}

test("returns unknown when no header is present", () => {
  assert.equal(clientIpFor(req(null)), "unknown");
});

test("uses the rightmost hop for a single trusted proxy", () => {
  // A caller-supplied spoofed value, then the real client appended by our proxy.
  assert.equal(clientIpFor(req("203.0.113.9, 198.51.100.4"), 1), "198.51.100.4");
});

test("errs toward over-limiting when fewer hops than proxies", () => {
  // Only one hop but two trusted proxies: fall back to the leftmost real entry.
  assert.equal(clientIpFor(req("198.51.100.4"), 2), "198.51.100.4");
});
