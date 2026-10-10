import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toMinor,
  fromMinor,
  addMinor,
  subMinor,
  splitMinor,
  toGrams,
  GRAMS_PER_OUNCE,
} from "../src/lib/units.ts";

test("toMinor parses decimal strings to cents", () => {
  assert.equal(toMinor("12.34"), 1234);
  assert.equal(toMinor("0.01"), 1);
  assert.equal(toMinor("7"), 700);
  assert.equal(toMinor("-1.25"), -125);
});

test("toMinor rejects more than 2 fraction digits", () => {
  assert.throws(() => toMinor("1.234"), RangeError);
  assert.throws(() => toMinor("abc"), RangeError);
  assert.throws(() => toMinor(""), RangeError);
});

test("fromMinor always renders 2 fraction digits", () => {
  assert.equal(fromMinor(1234), "12.34");
  assert.equal(fromMinor(5), "0.05");
  assert.equal(fromMinor(-125), "-1.25");
});

test("addMinor and subMinor guard overflow", () => {
  assert.equal(addMinor(1, 2), 3);
  assert.equal(subMinor(5, 2), 3);
  assert.throws(() => addMinor(Number.MAX_SAFE_INTEGER, 1), RangeError);
});

test("splitMinor parts always sum exactly to the total", () => {
  for (const [total, weights] of [
    [100, [1, 1, 1]],
    [7, [2, 3, 4]],
    [1000, [1, 2, 3, 4]],
  ] as const) {
    const parts = splitMinor(total, [...weights]);
    assert.equal(parts.reduce((a, b) => a + b, 0), total);
    assert.equal(parts.length, weights.length);
  }
});

test("toGrams converts units", () => {
  assert.equal(toGrams(1, "g"), 1);
  assert.equal(toGrams(1, "oz"), 28.3495); // GRAMS_PER_OUNCE rounded to 4 dp
  assert.equal(toGrams(1, "lb"), 453.5924);
  assert.equal(toGrams(1, "kg"), 1000);
  assert.throws(() => toGrams(-1, "g"), RangeError);
});
