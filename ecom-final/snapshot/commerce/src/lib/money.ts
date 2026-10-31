/** Parse a decimal string with ≤2 fraction digits into integer minor units. */
export function toMinor(amount: string): number {
  if (!/^-?\d+(\.\d{1,2})?$/.test(amount)) {
    throw new RangeError(`Invalid money amount: ${amount}`);
  }
  const [whole, frac = ""] = amount.split(".");
  const sign = whole.startsWith("-") ? -1 : 1;
  const absWhole = sign === -1 ? whole.slice(1) : whole;
  const minor = parseInt(absWhole, 10) * 100 + parseInt(frac.padEnd(2, "0"), 10);
  return sign * minor;
}

/** Format integer minor units into a decimal string with exactly 2 fraction digits. */
export function fromMinor(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${sign}${whole}.${frac.toString().padStart(2, "0")}`;
}

/** Add two integer minor-unit amounts, guarding MAX_SAFE_INTEGER. */
export function addMinor(a: number, b: number): number {
  const result = a + b;
  if (!Number.isSafeInteger(result)) {
    throw new RangeError(`Money addition overflow: ${a} + ${b}`);
  }
  return result;
}

/** Subtract b from a (integer minor units), guarding MAX_SAFE_INTEGER. */
export function subMinor(a: number, b: number): number {
  const result = a - b;
  if (!Number.isSafeInteger(result)) {
    throw new RangeError(`Money subtraction overflow: ${a} - ${b}`);
  }
  return result;
}

/** Distribute an integer total by weight; remainder to the largest weight. Parts always sum exactly to total. */
export function splitMinor(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const totalWeight = weights.reduce((s, w) => s + w, 0);
  if (totalWeight === 0) return weights.map(() => 0);
  const parts = weights.map(w => Math.floor(total * w / totalWeight));
  const allocated = parts.reduce((s, p) => s + p, 0);
  const remainder = total - allocated;
  let maxIdx = 0;
  for (let i = 1; i < weights.length; i++) {
    if (weights[i] > weights[maxIdx]) maxIdx = i;
  }
  parts[maxIdx] += remainder;
  return parts;
}

/** Split a total into house and vendor shares by houseBasisPoints (0–10000). Parts always sum exactly to total. */
export function houseSplit(total: number, houseBasisPoints: number): { house: number; vendor: number } {
  const house = Math.floor(total * houseBasisPoints / 10000);
  const vendor = total - house;
  return { house, vendor };
}
