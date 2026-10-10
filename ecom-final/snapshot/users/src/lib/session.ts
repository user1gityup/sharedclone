/**
 * Session read/verification helpers for route handlers.
 */
import { verifyJwt } from "./crypto";
import { getSigningKey } from "./keys";
import { db } from "./db";
import type { AccessTokenClaims } from "./types";

export function getBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : null;
}

/** Verify signature + expiry, then reject a token whose session was revoked. */
export function verifyAccessToken(token: string): AccessTokenClaims | null {
  const key = getSigningKey();
  const result = verifyJwt(token, key.publicKeyPem);
  if (!result) return null;

  const payload = result.payload as unknown as AccessTokenClaims;
  if (typeof payload.sid === "string") {
    const session = db.sessions.findBySid(payload.sid);
    if (session && !db.sessions.isActive(session)) return null;
  }
  return payload;
}

export function requireUser(request: Request): AccessTokenClaims | null {
  const token = getBearerToken(request);
  if (!token) return null;
  return verifyAccessToken(token);
}
