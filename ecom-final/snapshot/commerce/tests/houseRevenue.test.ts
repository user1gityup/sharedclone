import { describe, it } from "node:test";
import assert from "node:assert";

import { splitSellerCredit } from "../src/lib/houseRevenue.ts";
import { houseSplit as moneyHouseSplit } from "../src/lib/money.ts";

describe("houseRevenue", () => {
  it("splitSellerCredit 0 bps gives everything to vendor", () => {
    const { netMinor, houseCutMinor } = splitSellerCredit(10000, 0);
    assert.strictEqual(houseCutMinor, 0);
    assert.strictEqual(netMinor, 10000);
  });

  it("splitSellerCredit 1000 bps (10%)", () => {
    const { netMinor, houseCutMinor } = splitSellerCredit(10000, 1000);
    assert.strictEqual(houseCutMinor, 1000);
    assert.strictEqual(netMinor, 9000);
  });
});
