/**
 * Signing key loader. Loads the Ed25519 private key from
 * `SESSION_PRIVATE_KEY_PEM` (PKCS#8 PEM), derives the public key and `kid`, and
 * falls back to an ephemeral dev key when unset or malformed. Cached per process.
 */
import * as crypto from "node:crypto";
import { keyIdFromPublicKey } from "./crypto";

export interface SigningKey {
  privateKeyPem: string;
  publicKeyPem: string;
  keyId: string;
}

let cached: SigningKey | null = null;

export function getSigningKey(): SigningKey {
  if (cached) return cached;

  const privateKeyPem = process.env.SESSION_PRIVATE_KEY_PEM || "";
  if (privateKeyPem) {
    try {
      const privateKey = crypto.createPrivateKey(privateKeyPem);
      const publicKeyPem = crypto
        .createPublicKey(privateKey)
        .export({ type: "spki", format: "pem" })
        .toString();
      cached = {
        privateKeyPem,
        publicKeyPem,
        keyId: process.env.SESSION_KEY_ID || keyIdFromPublicKey(publicKeyPem),
      };
      return cached;
    } catch {
      // fall through to an ephemeral dev key on malformed PEM
    }
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  cached = {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem,
    keyId: process.env.SESSION_KEY_ID || keyIdFromPublicKey(publicKeyPem),
  };
  return cached;
}

/** Test helper: drop the cached key so the next call re-reads the environment. */
export function resetSigningKey(): void {
  cached = null;
}
