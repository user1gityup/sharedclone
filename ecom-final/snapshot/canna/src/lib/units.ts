// Money and weight helpers. Pure functions, no I/O, no dependencies.
//
// Money is handled in integer minor units (cents) only. All arithmetic uses
// safe-integer guards so a malformed or adversarial input fails loudly instead
// of silently overflowing.

export const MAX_MINOR = Number.MAX_SAFE_INTEGER;

/**
 * Parse a decimal string with at most 2 fraction digits into integer minor
 * units (cents). Throws RangeError on >2 fraction digits or non-numeric input.
 */
export function toMinor(amount: string): number {
  if (typeof amount !== "string" || amount.trim() === "") {
    throw new RangeError("amount must be a non-empty decimal string");
  }
  const m = /^([+-]?)(\d+)(?:\.(\d{0,2}))?$/.exec(amount.trim());
  if (!m) throw new RangeError(`invalid decimal amount: ${amount}`);
  const sign = m[1] === "-" ? -1 : 1;
  const whole = m[2];
  const frac = (m[3] ?? "").padEnd(2, "0");
  const value = sign * (Number(whole) * 100 + Number(frac));
  if (!Number.isSafeInteger(value)) throw new RangeError(`amount out of safe range: ${amount}`);
  return value;
}

/**
 * Format an integer minor-unit amount as a decimal string with exactly 2
 * fraction digits (e.g. 1234 -> "12.34").
 */
export function fromMinor(minor: number): string {
  if (!Number.isSafeInteger(minor)) throw new RangeError("minor must be a safe integer");
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100);
  const frac = (abs % 100).toString().padStart(2, "0");
  return `${sign}${whole}.${frac}`;
}

/** Add two minor-unit integers, guarding against safe-integer overflow. */
export function addMinor(a: number, b: number): number {
  const r = a + b;
  if (!Number.isSafeInteger(r)) throw new RangeError("minor addition overflow");
  return r;
}

/** Subtract two minor-unit integers, guarding against safe-integer overflow. */
export function subMinor(a: number, b: number): number {
  const r = a - b;
  if (!Number.isSafeInteger(r)) throw new RangeError("minor subtraction overflow");
  return r;
}

/**
 * Distribute an integer total across the given weights so the parts always sum
 * exactly to the total. Any remainder from integer division is given to the
 * largest weight.
 */
export function splitMinor(total: number, weights: number[]): number[] {
  if (!Number.isSafeInteger(total)) throw new RangeError("total must be a safe integer");
  if (!Array.isArray(weights) || weights.length === 0) throw new RangeError("weights must be a non-empty array");
  for (const w of weights) {
    if (typeof w !== "number" || !Number.isFinite(w) || w < 0) {
      throw new RangeError("weights must be non-negative finite numbers");
    }
  }
  const sum = weights.reduce((acc, w) => acc + w, 0);
  if (sum === 0) throw new RangeError("weights must sum to a positive number");

  const parts = weights.map((w) => Math.floor((total * w) / sum));
  const assigned = parts.reduce((acc, p) => acc + p, 0);
  let remainder = total - assigned;

  // Give the remainder to the largest weight(s), one unit each, largest first.
  const order = weights
    .map((w, i) => ({ w, i }))
    .sort((a, b) => b.w - a.w);
  let idx = 0;
  while (remainder > 0 && idx < order.length) {
    parts[order[idx].i] += 1;
    remainder -= 1;
    idx = (idx + 1) % order.length;
  }
  return parts;
}

export const GRAMS_PER_OUNCE = 28.349523125;

export type WeightUnit = "g" | "oz" | "lb" | "kg";

const UNIT_TO_GRAMS: Record<WeightUnit, number> = {
  g: 1,
  oz: GRAMS_PER_OUNCE,
  lb: GRAMS_PER_OUNCE * 16,
  kg: 1000,
};

/**
 * Convert a weight value in the given unit to grams, rounded to 4 decimal
 * places.
 */
export function toGrams(value: number, unit: WeightUnit): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new RangeError("value must be a non-negative finite number");
  }
  const factor = UNIT_TO_GRAMS[unit];
  if (factor === undefined) throw new RangeError(`unknown weight unit: ${unit}`);
  return Math.round(value * factor * 10000) / 10000;
}
