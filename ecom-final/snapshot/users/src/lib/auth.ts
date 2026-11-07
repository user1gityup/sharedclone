/**
 * Session issuance and refresh orchestration. Thin glue over crypto.ts, keys.ts
 * and db.ts — it assembles claims, signs tokens, and manages refresh rotation.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { signJwt } from "./crypto";
import { getSigningKey } from "./keys";
import { db } from "./db";
import {
  getDefaultAudience,
  getIssuer,
  getRefreshTtlSeconds,
  getSessionTtlSeconds,
} from "./config";
import type { AccessTokenClaims, TokenPair, User } from "./types";

export function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export interface IssueTokensOptions {
  user: User;
  aud?: string;
  amr: string[];
  scope?: string;
  device?: string | null;
  authTime?: number;
  nonce?: string;
}

function buildClaims(
  options: IssueTokensOptions,
  sid: string,
  now: number,
  jti: string,
): AccessTokenClaims {
  return {
    sub: options.user.id,
    iss: getIssuer(),
    aud: options.aud || getDefaultAudience(),
    amr: options.amr,
    iat: now,
    exp: now + getSessionTtlSeconds(),
    jti,
    sid,
    ver: 1,
    email: options.user.email,
    email_verified: options.user.emailVerified,
    name: options.user.name ?? undefined,
    picture: options.user.picture ?? undefined,
    scope: options.scope,
    auth_time: options.authTime,
    nonce: options.nonce,
  };
}

export function issueTokens(options: IssueTokensOptions): TokenPair {
  const key = getSigningKey();
  const now = Math.floor(Date.now() / 1000);
  const sid = `sid_${randomBytes(12).toString("base64url")}`;

  db.sessions.create({
    sid,
    userId: options.user.id,
    amr: options.amr,
    device: options.device ?? null,
    ttlSeconds: getRefreshTtlSeconds(),
  });

  const accessClaims = buildClaims(options, sid, now, randomUUID());
  const accessToken = signJwt(accessClaims, {
    privateKeyPem: key.privateKeyPem,
    kid: key.keyId,
    expiresInSeconds: getSessionTtlSeconds(),
  });

  const idClaims: AccessTokenClaims = {
    ...accessClaims,
    jti: randomUUID(),
    auth_time: options.authTime ?? now,
    nonce: options.nonce,
  };
  const idToken = signJwt(idClaims, {
    privateKeyPem: key.privateKeyPem,
    kid: key.keyId,
    expiresInSeconds: getSessionTtlSeconds(),
  });

  const refreshToken = generateOpaqueToken();
  db.sessions.attachRefreshToken(sid, refreshToken);

  return {
    accessToken,
    refreshToken,
    idToken,
    expiresIn: getSessionTtlSeconds(),
    tokenType: "Bearer",
  };
}

/** Rotate a refresh token: validate, revoke the old session, issue fresh tokens. */
export async function refreshSession(refreshToken: string): Promise<TokenPair | null> {
  const session = db.sessions.findByRefreshToken(refreshToken);
  if (!db.sessions.isActive(session)) return null;

  const user = await db.users.findById(session.userId);
  if (!user) return null;

  db.sessions.revokeBySid(session.sid);
  return issueTokens({
    user,
    amr: session.amr,
    device: session.device,
    scope: undefined,
  });
}
