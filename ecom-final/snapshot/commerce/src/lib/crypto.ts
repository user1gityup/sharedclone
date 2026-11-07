import crypto from "crypto";

// AES-256-GCM encryption for the settings vault. The key is derived from
// SETTINGS_ENCRYPTION_KEY (env) via a KDF. When unset, falls back to a
// process-random key so the app still starts in mock/sandbox mode — but a
// value saved with a random key is only readable for that process lifetime.
// This mirrors billboard's lib/crypto.js convention without holding any
// real secret-shaped material in the repo.

const KDF_CONTEXT = "commerce:integration-settings:v1";

function deriveKey(): Buffer {
  const raw = process.env.SETTINGS_ENCRYPTION_KEY;
  const secret = raw || crypto.randomBytes(32).toString("base64");
  if (raw) {
    return crypto.createHash("sha256").update(`${KDF_CONTEXT}:${raw}`).digest();
  }
  return crypto.createHash("sha256").update(`${KDF_CONTEXT}:${secret}`).digest();
}

export function encrypt(plaintext: string, context = KDF_CONTEXT): string {
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(".");
}

export function decrypt(payload: string, context = KDF_CONTEXT): string {
  const key = deriveKey();
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Malformed encrypted value");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}