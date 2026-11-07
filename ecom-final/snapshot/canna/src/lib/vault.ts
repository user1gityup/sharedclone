// Encrypted credential vault. AES-256-GCM, DB-backed with an env fallback and a
// 5-second in-memory cache. Ported from billboard-platform's lib/settings.js and
// adapted to own the copy permanently (no shared package with `commerce`).
//
// This is the single secret store for per-vendor POS/ERP/compliance/payment
// credentials. Do not invent a second one.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12; // GCM recommended nonce size
const FORMAT_VERSION = "v1";
const CACHE_TTL_MS = 5000;

export class VaultError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "VaultError";
    this.code = code;
  }
}

/**
 * Normalize a secret into a 32-byte AES key. A 32-byte input is used verbatim;
 * anything else is hashed to 32 bytes.
 */
function deriveKey(secret: string | Buffer): Buffer {
  const raw = Buffer.isBuffer(secret) ? secret : Buffer.from(secret, "utf8");
  if (raw.length === KEY_BYTES) return raw;
  return createHash("sha256").update(raw).digest();
}

/** Encrypt a plaintext secret to the "v1.iv.tag.ciphertext" base64url form. */
export function encryptSecret(plaintext: string, key: string | Buffer): string {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new VaultError("vault_invalid_input", "plaintext must be a non-empty string");
  }
  const k = deriveKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, k, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [FORMAT_VERSION, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

/** Decrypt a value produced by encryptSecret. Throws VaultError on tampering. */
export function decryptSecret(payload: string, key: string | Buffer): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) {
    throw new VaultError("vault_invalid_ciphertext", "ciphertext is not v1 format");
  }
  const k = deriveKey(key);
  const iv = Buffer.from(parts[1], "base64url");
  const tag = Buffer.from(parts[2], "base64url");
  const data = Buffer.from(parts[3], "base64url");
  const decipher = createDecipheriv(ALGO, k, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    throw new VaultError("vault_invalid_ciphertext", "decryption failed (tampered or wrong key)");
  }
}

/**
 * A keyed vault with a 5-second cache. Values are read through the optional
 * `lookup` (typically the IntegrationSetting table); when a key is absent there
 * the vault falls back to the corresponding environment variable.
 */
export class CredentialVault {
  private readonly cache = new Map<string, { value: string; at: number }>();
  private readonly masterKey: string;
  private readonly lookup?: (key: string) => Promise<string | undefined>;

  constructor(masterKey: string, lookup?: (key: string) => Promise<string | undefined>) {
    this.masterKey = masterKey;
    this.lookup = lookup;
  }

  private resolveKey(): string {
    return this.masterKey || process.env.INTEGRATION_VAULT_KEY || "";
  }

  /** Retrieve and decrypt a secret, caching for 5 seconds. */
  async get(key: string): Promise<string | undefined> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

    let value: string | undefined;
    const encrypted = this.lookup ? await this.lookup(key) : undefined;
    if (encrypted !== undefined) {
      value = decryptSecret(encrypted, this.resolveKey());
    } else {
      value = process.env[key];
    }
    if (value !== undefined) this.cache.set(key, { value, at: Date.now() });
    return value;
  }

  /** Invalidate the cache (used by the admin rotation UI after a re-encrypt). */
  invalidate(key?: string): void {
    if (key) this.cache.delete(key);
    else this.cache.clear();
  }
}
