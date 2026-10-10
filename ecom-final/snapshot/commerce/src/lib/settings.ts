import { prisma } from "./prisma.ts";
import { encrypt, decrypt } from "./crypto.ts";

// DB-backed encrypted settings vault. Checks IntegrationSetting first, then
// falls back to process.env[key]. 5s cache. Holds Stripe/Solana keys so
// they never appear in the client bundle or in plain text at rest.

const CACHE_TTL_MS = 5000;
const cache = new Map<string, { value: string | null; expiresAt: number }>();

export async function getSetting(key: string): Promise<string | null> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let value: string | null = null;
  try {
    const row = await prisma.integrationSetting.findUnique({ where: { key } });
    if (row) value = decrypt(row.value);
  } catch (err) {
    console.error(`[settings] getSetting(${key}) DB lookup failed: ${(err as Error).message}`);
  }

  if (value === null) value = process.env[key] || null;

  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const encrypted = encrypt(value);
  await prisma.integrationSetting.upsert({
    where: { key },
    create: { key, value: encrypted },
    update: { value: encrypted },
  });
  cache.delete(key);
}

export async function getSettingStatus(key: string): Promise<{ configured: boolean; last4: string | null }> {
  const value = await getSetting(key);
  if (!value) return { configured: false, last4: null };
  return { configured: true, last4: value.slice(-4) };
}