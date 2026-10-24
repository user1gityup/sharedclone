import { createRemoteJWKSet, jwtVerify } from "jose";

// In-memory JWKS cache shared across requests. `jose`'s createRemoteJWKSet
// already handles caching (fetches at most once per cacheMaxAge, refreshes
// on cache miss), so we create it once and reuse it for the server's lifetime.
let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJWKS(): ReturnType<typeof createRemoteJWKSet> {
  if (!_jwks) {
    const jwksUrl = process.env.USERS_JWKS_URL || "http://localhost:3001/.well-known/jwks.json";
    _jwks = createRemoteJWKSet(new URL(jwksUrl), {
      cacheMaxAge: 300_000, // 5 minutes, matching USERS-CONTRACT.md Cache-Control
    });
  }
  return _jwks;
}

// Test-only: forces the next call to re-read USERS_JWKS_URL and rebuild the
// remote key set, so tests can point at a different JWKS endpoint.
export function __resetJwksCacheForTests(): void {
  _jwks = null;
}

export interface VerifiedToken {
  sub: string;       // users-service opaque user id (usr_...)
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
  amr: string[];
  scope?: string;
}

// Verifies a Bearer token against the users-service JWKS.
// Rejects any alg other than EdDSA (USERS-CONTRACT.md §1).
// Returns the verified payload or throws on any failure.
export async function verifyToken(token: string): Promise<VerifiedToken> {
  const issuer = process.env.USERS_ISSUER || "http://localhost:3001";
  const audience = process.env.USERS_AUDIENCE || "commerce";

  const jwks = getJWKS();

  const { payload } = await jwtVerify(token, jwks, {
    issuer,
    audience,
    algorithms: ["EdDSA"], // reject any other alg — USERS-CONTRACT.md §1, §9
    clockTolerance: 60,    // USERS-CONTRACT.md §9 — 60s leeway
  });

  // Validate required claims shape (jose already validated iss, aud, exp, alg)
  if (!payload.sub || typeof payload.sub !== "string") {
    throw new Error("Token missing required sub claim");
  }
  if (!payload.jti || typeof payload.jti !== "string") {
    throw new Error("Token missing required jti claim");
  }
  if (!Array.isArray(payload.amr)) {
    throw new Error("Token missing required amr claim");
  }

  return payload as unknown as VerifiedToken;
}

// Extracts the Bearer token from an Authorization header.
// Returns null when the header is missing or malformed.
export function extractBearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) return null;
  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

// Convenience: gets the verified user from a request's Authorization header.
// Returns null when not authenticated; throws on invalid tokens.
export async function getSessionUser(request: Request): Promise<VerifiedToken | null> {
  const header = request.headers.get("authorization");
  const token = extractBearerToken(header);
  if (!token) return null;
  return verifyToken(token);
}
