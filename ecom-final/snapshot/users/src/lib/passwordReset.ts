/**
 * Password reset tokens: single-use, one hour, stored only as hashes.
 */
import { db } from "./db";

export const RESET_TOKEN_TTL_SECONDS = 60 * 60;

export function createPasswordResetToken(userId: string): string {
  return db.passwordResets.issue(userId, RESET_TOKEN_TTL_SECONDS);
}

export function consumePasswordResetToken(token: string): string | null {
  return db.passwordResets.consume(token);
}
