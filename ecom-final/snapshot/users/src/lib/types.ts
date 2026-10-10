/**
 * Shared TypeScript types for the users identity service.
 *
 * Claim names are frozen here and in CONTRACT.md — keep them in sync. This file
 * carries no runtime code, only erasable type information.
 */

export interface User {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
  passwordHash: string | null;
  emailVerified: boolean;
  totpSecret: string | null;
  /** epoch milliseconds */
  createdAt: number;
  /** epoch milliseconds */
  updatedAt: number;
}

export interface SessionRecord {
  jti: string;
  sid: string;
  userId: string;
  refreshTokenHash: string | null;
  device: string | null;
  issuedAt: number;
  expiresAt: number;
  revokedAt: number | null;
  amr: string[];
}

/** Frozen claim names (CONTRACT.md §4). */
export const ClaimNames = {
  sub: "sub",
  iss: "iss",
  aud: "aud",
  exp: "exp",
  iat: "iat",
  jti: "jti",
  amr: "amr",
  email: "email",
  email_verified: "email_verified",
  name: "name",
  picture: "picture",
  sid: "sid",
  ver: "ver",
  scope: "scope",
  auth_time: "auth_time",
  nonce: "nonce",
} as const;

export type ClaimName = (typeof ClaimNames)[keyof typeof ClaimNames];

export interface AccessTokenClaims {
  sub: string;
  iss: string;
  aud: string;
  exp: number;
  iat: number;
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

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  expiresIn: number;
  tokenType: "Bearer";
}

export interface PublicUser {
  id: string;
  email: string;
  email_verified: boolean;
  name: string | null;
  picture: string | null;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    email_verified: user.emailVerified,
    name: user.name,
    picture: user.picture,
  };
}
