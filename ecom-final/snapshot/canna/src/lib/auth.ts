// Session-token verifier. This storefront VERIFIES EdDSA/Ed25519 JWTs against
// the users service public JWKS and can never mint a token. It holds no signing
// key. Implemented from USERS-CONTRACT.md, independently of `commerce`.

import {
  createLocalJWKSet,
  createRemoteJWKSet,
  jwtVerify,
  type JSONWebKeySet,
  type JWTPayload,
} from "jose";

const EDDSA = "EdDSA";
const OKP = "OKP";
const ED25519 = "Ed25519";
const JWT = "JWT";
const DEFAULT_CLOCK_TOLERANCE_SECONDS = 60;

export class TokenVerificationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "TokenVerificationError";
    this.code = code;
  }
}

export interface VerifiedClaims extends JWTPayload {
  sub: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
  amr: string[];
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  sid?: string;
  ver?: number;
  scope?: string;
  auth_time?: number;
  nonce?: string;
}

export interface VerifyOptions {
  issuer: string;
  audience: string;
  clockToleranceSeconds?: number;
  nonce?: string;
}

interface JwtHeader {
  alg?: unknown;
  typ?: unknown;
  kid?: unknown;
}

function decodeHeader(token: string): JwtHeader {
  if (typeof token !== "string" || token.length === 0) {
    throw new TokenVerificationError("missing_token", "token is missing or empty");
  }
  const [headerB64] = token.split(".");
  if (!headerB64) throw new TokenVerificationError("malformed_token", "token is malformed");
  let raw: string;
  try {
    raw = Buffer.from(headerB64, "base64url").toString("utf8");
  } catch {
    throw new TokenVerificationError("malformed_token", "token header is not base64url");
  }
  try {
    return JSON.parse(raw) as JwtHeader;
  } catch {
    throw new TokenVerificationError("malformed_token", "token header is not valid JSON");
  }
}

/** Enforce header and claim rules before signature verification. */
function assertHeader(header: JwtHeader): void {
  if (header.alg !== EDDSA) {
    throw new TokenVerificationError("unsupported_alg", `alg must be ${EDDSA}`);
  }
  if (header.typ !== JWT) {
    throw new TokenVerificationError("unsupported_typ", `typ must be ${JWT}`);
  }
  if (typeof header.kid !== "string" || header.kid.length === 0) {
    throw new TokenVerificationError("missing_kid", "kid is required");
  }
}

function assertJwkIsEd25519(jwks: JSONWebKeySet): void {
  for (const key of jwks.keys ?? []) {
    if (key.kty !== OKP || key.crv !== ED25519) {
      throw new TokenVerificationError("unsupported_key", "JWKS contains a non-OKP/Ed25519 key");
    }
    if (key.alg !== undefined && key.alg !== EDDSA) {
      throw new TokenVerificationError("unsupported_key", "JWK alg is not EdDSA");
    }
  }
}

function assertClaims(payload: JWTPayload, opts: VerifyOptions): void {
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new TokenVerificationError("invalid_claims", "sub must be a non-empty string");
  }
  if (typeof payload.jti !== "string" || payload.jti.length === 0) {
    throw new TokenVerificationError("invalid_claims", "jti must be a non-empty string");
  }
  if (!Array.isArray(payload.amr)) {
    throw new TokenVerificationError("invalid_claims", "amr must be an array");
  }
  if (typeof payload.iat === "number") {
    const nowSec = Math.floor(Date.now() / 1000);
    const tolerance = opts.clockToleranceSeconds ?? DEFAULT_CLOCK_TOLERANCE_SECONDS;
    if (payload.iat > nowSec + tolerance) {
      throw new TokenVerificationError("invalid_claims", "iat is in the future beyond leeway");
    }
  }
  if (opts.nonce !== undefined && payload.nonce !== opts.nonce) {
    throw new TokenVerificationError("nonce_mismatch", "nonce does not match");
  }
}

/**
 * Verify an EdDSA/Ed25519 JWT against an in-memory JWKS object. No network.
 * Rejects any alg other than EdDSA, any key that is not OKP/Ed25519, and any
 * mismatch in iss/aud/exp/iat/jti/amr/nonce.
 */
export async function verifyEdDsaToken(
  token: string,
  jwks: JSONWebKeySet,
  opts: VerifyOptions,
): Promise<VerifiedClaims> {
  const header = decodeHeader(token);
  assertHeader(header);
  assertJwkIsEd25519(jwks);

  const keySet = createLocalJWKSet(jwks);
  let payload: JWTPayload;
  try {
    const result = await jwtVerify(token, keySet, {
      algorithms: [EDDSA],
      issuer: opts.issuer,
      audience: opts.audience,
      clockTolerance: opts.clockToleranceSeconds ?? DEFAULT_CLOCK_TOLERANCE_SECONDS,
    });
    payload = result.payload;
  } catch (err) {
    if (err instanceof TokenVerificationError) throw err;
    const message = err instanceof Error ? err.message : "signature verification failed";
    throw new TokenVerificationError("invalid_signature", message);
  }
  assertClaims(payload, opts);
  return payload as VerifiedClaims;
}

/**
 * Build a verifier that fetches and caches the users JWKS over HTTPS. Use this
 * in the running app; use verifyEdDsaToken for tests and offline contexts.
 */
export function createRemoteVerifier(config: {
  jwksUrl: string;
  issuer: string;
  audience: string;
}) {
  const jwks = createRemoteJWKSet(new URL(config.jwksUrl));
  return async function verify(
    token: string,
    opts?: { nonce?: string; clockToleranceSeconds?: number },
  ): Promise<VerifiedClaims> {
    const header = decodeHeader(token);
    assertHeader(header);
    let payload: JWTPayload;
    try {
      const result = await jwtVerify(token, jwks, {
        algorithms: [EDDSA],
        issuer: config.issuer,
        audience: config.audience,
        clockTolerance: opts?.clockToleranceSeconds ?? DEFAULT_CLOCK_TOLERANCE_SECONDS,
      });
      payload = result.payload;
    } catch (err) {
      if (err instanceof TokenVerificationError) throw err;
      const message = err instanceof Error ? err.message : "signature verification failed";
      throw new TokenVerificationError("invalid_signature", message);
    }
    assertClaims(payload, {
      issuer: config.issuer,
      audience: config.audience,
      clockToleranceSeconds: opts?.clockToleranceSeconds,
      nonce: opts?.nonce,
    });
    return payload as VerifiedClaims;
  };
}

/** True when the token's `amr` shows a TOTP or backup second factor. */
export function hasTwoFactor(claims: VerifiedClaims): boolean {
  return Array.isArray(claims.amr) && (claims.amr.includes("totp") || claims.amr.includes("backup"));
}
