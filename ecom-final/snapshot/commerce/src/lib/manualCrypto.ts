// Manual crypto (ETH/BTC) — admin-confirmed payments.
// Ported from billboard-platform/lib/manualCrypto.js

import { getSetting } from "./settings.ts";

export const MANUAL_CRYPTO_METHODS = new Set(["ETH", "BTC"]);

const ENV_VAR: Record<string, string> = { ETH: "ETH_MERCHANT_WALLET", BTC: "BTC_MERCHANT_WALLET" };

export function isManualCryptoMethod(method: string): boolean {
  return MANUAL_CRYPTO_METHODS.has(method);
}

export async function getManualCryptoAddress(method: string): Promise<string | null> {
  const envVar = ENV_VAR[method];
  if (!envVar) return null;
  return getSetting(envVar);
}
