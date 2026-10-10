import { getSetting } from "./settings.ts";
import { houseSplit as moneyHouseSplit } from "./money.ts";

// The admin-configurable basis-points (0-10000) the platform keeps from
// every vendor sale. Defaults to 0 — no cut unless explicitly set.

export async function getHouseBasisPoints(): Promise<number> {
  const raw = await getSetting("HOUSE_PLATFORM_BPS");
  const parsed = Number(raw);
  if (!raw || !Number.isFinite(parsed)) return 0;
  return Math.min(10000, Math.max(0, parsed));
}

// Splits a gross order amount into house and vendor shares.
export async function splitOrderRevenue(grossMinor: number): Promise<{ house: number; vendor: number }> {
  const bps = await getHouseBasisPoints();
  return moneyHouseSplit(grossMinor, bps);
}

// Pure-helper variant for use without DB access (e.g. in a transaction
// where the caller already knows the rate).
export function splitSellerCredit(grossMinor: number, houseBasisPoints: number): { netMinor: number; houseCutMinor: number } {
  const { house, vendor } = moneyHouseSplit(grossMinor, houseBasisPoints);
  return { netMinor: vendor, houseCutMinor: house };
}
