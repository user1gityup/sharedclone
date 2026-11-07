/**
 * Ed25519 / EdDSA session signing, JWKS export, scrypt password hashing, and
 * AES-256-GCM at-rest encryption for the users identity service.
 *
 * Zero external runtime dependencies: everything here is Node's built-in
 * `node:crypto`. Sessions are signed with EdDSA over Ed25519 (JWS alg "EdDSA",
 * JWK kty "OKP", crv "Ed25519") exactly as CONTRACT.md freezes.
 */
import * as crypto from "node:crypto";

export interface KeyPair {
  publicKeyPem: string;
  privateKeyPem: string;
}

export interface Jwk {
  kty: "OKP";
  crv: "Ed25519";
  x: string;
  kid: string;
  use: "sig";
  alg: "EdDSA";
}

export function generateKeyPair(): KeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

export function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/** Raw 32-byte Ed25519 public key from a SPKI PEM. */
export function rawPublicKey(publicKeyPem: string): Buffer {
  const key = crypto.createPublicKey(publicKeyPem);
  const der = key.export({ type: "spki", format: "der" });
  const bytes = Buffer.isBuffer(der) ? der : Buffer.from(der);
  // Ed25519 SPKI DER is a fixed prefix followed by the raw 32-byte key.
  return bytes.subarray(bytes.length - 32);
}

export function keyIdFromPublicKey(publicKeyPem: string): string {
  const digest = crypto.createHash("sha256").update(rawPublicKey(publicKeyPem)).digest();
  return base64url(digest.subarray(0, 16));
}

export function jwkFromPublicKey(publicKeyPem: string, kid: string): Jwk {
  return {
    kty: "OKP",
    crv: "Ed25519",
    x: base64url(rawPublicKey(publicKeyPem)),
    kid,
    use: "sig",
    alg: "EdDSA",
  };
}

export function signEd25519(data: Buffer, privateKeyPem: string): Buffer {
  const key = crypto.createPrivateKey(privateKeyPem);
  return crypto.sign(null, data, key);
}

export function verifyEd25519(
  data: Buffer,
  signature: Buffer,
  publicKeyPem: string,
): boolean {
  const key = crypto.createPublicKey(publicKeyPem);
  return crypto.verify(null, data, key, signature);
}

export interface SignJwtOptions {
  privateKeyPem: string;
  kid: string;
  expiresInSeconds: number;
  nowSeconds?: number;
}

/**
 * Sign a JWT. Adds `iat`, `exp`, and a fresh `jti` unless the caller already
 * supplied them in `claims`.
 */
export function signJwt(claims: object, options: SignJwtOptions): string {
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const header = { alg: "EdDSA", typ: "JWT", kid: options.kid };
  const payload: Record<string, unknown> = {
    ...(claims as Record<string, unknown>),
  };
  if (payload.iat === undefined) payload.iat = now;
  if (payload.exp === undefined) payload.exp = now + options.expiresInSeconds;
  if (payload.jti === undefined) payload.jti = crypto.randomUUID();

  const h = base64url(JSON.stringify(header));
  const p = base64url(JSON.stringify(payload));
  const signature = signEd25519(
    Buffer.from(`${h}.${p}`, "ascii"),
    options.privateKeyPem,
  );
  return `${h}.${p}.${base64url(signature)}`;
}

export interface VerifyJwtResult {
  header: { alg: string; typ: string; kid: string };
  payload: Record<string, unknown>;
}

/**
 * Verify a JWT signature and `exp`. Returns null on malformed input, signature
 * mismatch, wrong `alg`, or expiry. Callers apply `iss`/`aud` checks themselves.
 */
export function verifyJwt(token: string, publicKeyPem: string): VerifyJwtResult | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;

  let signature: Buffer;
  try {
    signature = Buffer.from(s, "base64url");
  } catch {
    return null;
  }

  const data = Buffer.from(`${h}.${p}`, "ascii");
  if (!verifyEd25519(data, signature, publicKeyPem)) return null;

  let parsed: VerifyJwtResult;
  try {
    parsed = {
      header: JSON.parse(Buffer.from(h, "base64url").toString("utf8")),
      payload: JSON.parse(Buffer.from(p, "base64url").toString("utf8")),
    };
  } catch {
    return null;
  }

  if (parsed.header.alg !== "EdDSA") return null;
  if (
    typeof parsed.payload.exp === "number" &&
    parsed.payload.exp < Math.floor(Date.now() / 1000)
  ) {
    return null;
  }
  return parsed;
}

// --- scrypt password hashing ---

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LEN = 32;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], "base64");
    expected = Buffer.from(parts[5], "base64");
  } catch {
    return false;
  }
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) {
    return false;
  }
  const actual = crypto.scryptSync(password, salt, expected.length, { N, r, p });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// --- AES-256-GCM at-rest encryption ---
// The key is derived with scrypt from a caller-supplied master secret and a
// `context` string, so distinct fields never share a derived key.

export function encrypt(plaintext: string, context: string, masterSecret: string): string {
  const key = crypto.scryptSync(masterSecret, context, 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function decrypt(stored: string, context: string, masterSecret: string): string {
  const raw = Buffer.from(stored, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const key = crypto.scryptSync(masterSecret, context, 32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
