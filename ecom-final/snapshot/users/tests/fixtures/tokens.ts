/**
 * Test fixtures for a storefront's session-token verifier (BUILD-BRIEF.md §8).
 * Plain-object fixtures only — no signing, no crypto, no imports. Times are
 * fixed numbers relative to FIXED_NOW, never Date.now().
 */

/** A fixed "now" (seconds since epoch) so every fixture is deterministic. */
export const FIXED_NOW = 1_700_000_000;

export const JWKS_FIXTURE = {
  keys: [
    {
      kty: "OKP",
      crv: "Ed25519",
      kid: "kid-test-1",
      x: "<placeholder base64url>",
      use: "sig",
      alg: "EdDSA",
    },
  ],
} as const;

/** A fully valid claims object. */
export const CLAIMS_VALID = {
  iss: "https://users.example.com",
  sub: "usr_test",
  aud: "canna",
  iat: FIXED_NOW,
  exp: FIXED_NOW + 900,
  jti: "jti-test-1",
  amr: ["pwd", "totp"],
  sid: "sid-test-1",
  ver: 1,
} as const;

/** Invalid because exp is in the past. */
export const CLAIMS_EXPIRED = { ...CLAIMS_VALID, exp: FIXED_NOW - 1 } as const;

/** Invalid because iss differs from the expected issuer. */
export const CLAIMS_WRONG_ISSUER = {
  ...CLAIMS_VALID,
  iss: "https://evil.example.com",
} as const;

/** Invalid because aud differs from the relying storefront's audience. */
export const CLAIMS_WRONG_AUDIENCE = { ...CLAIMS_VALID, aud: "commerce" } as const;

/** Invalid because jti is missing. */
export const CLAIMS_MISSING_JTI = (() => {
  const { jti: _jti, ...rest } = CLAIMS_VALID;
  return rest;
})() as const;

/** Invalid because iat is in the future. */
export const CLAIMS_FUTURE_IAT = {
  ...CLAIMS_VALID,
  iat: FIXED_NOW + 86400,
} as const;
