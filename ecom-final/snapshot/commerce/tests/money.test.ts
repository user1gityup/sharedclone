import { describe, it } from "node:test";
import assert from "node:assert";

// Inline the module under test (no transpilation needed for pure functions)
import { toMinor, fromMinor, addMinor, subMinor, splitMinor, houseSplit } from "../src/lib/money.ts";

describe("money", () => {
  describe("toMinor", () => {
    it("parses a whole dollar", () => {
      assert.strictEqual(toMinor("5"), 500);
    });

    it("parses dollars and cents", () => {
      assert.strictEqual(toMinor("5.99"), 599);
    });

    it("parses negative amounts", () => {
      assert.strictEqual(toMinor("-10.50"), -1050);
    });

    it("rejects too many fraction digits", () => {
      assert.throws(() => toMinor("1.999"), RangeError);
    });
  });

  describe("fromMinor", () => {
    it("formats a positive minor amount", () => {
      assert.strictEqual(fromMinor(599), "5.99");
    });

    it("formats zero", () => {
      assert.strictEqual(fromMinor(0), "0.00");
    });

    it("formats negative amounts", () => {
      assert.strictEqual(fromMinor(-1050), "-10.50");
    });
  });

  describe("addMinor", () => {
    it("adds two amounts", () => {
      assert.strictEqual(addMinor(100, 200), 300);
    });
  });

  describe("subMinor", () => {
    it("subtracts two amounts", () => {
      assert.strictEqual(subMinor(500, 300), 200);
    });
  });

  describe("splitMinor", () => {
    it("splits by weight, remainder to largest", () => {
      const parts = splitMinor(100, [3, 2, 1]);
      assert.strictEqual(parts.reduce((a: number, b: number) => a + b, 0), 100);
      assert.strictEqual(parts[0], 51); // 3/6 * 100 = 50, remainder 1 goes to largest weight
      assert.strictEqual(parts[1], 33);
      assert.strictEqual(parts[2], 16);
    });

    it("returns empty for empty weights", () => {
      assert.deepStrictEqual(splitMinor(100, []), []);
    });
  });

  describe("houseSplit", () => {
    it("splits with 5% house cut (500 bps)", () => {
      const { house, vendor } = houseSplit(10000, 500);
      assert.strictEqual(house + vendor, 10000);
      assert.strictEqual(house, 500);
      assert.strictEqual(vendor, 9500);
    });

    it("splits with 0 bps (no cut)", () => {
      const { house, vendor } = houseSplit(10000, 0);
      assert.strictEqual(house, 0);
      assert.strictEqual(vendor, 10000);
    });
  });
});
