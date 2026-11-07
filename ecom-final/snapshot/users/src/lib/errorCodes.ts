/**
 * Auth error-code table (BUILD-BRIEF.md §8 local unit).
 *
 * Stable lower-snake-case codes mapped to { httpStatus, message, retryable }.
 * Messages are for end users: no internals, no field names, and never a hint
 * about whether an email exists.
 */

export const AUTH_ERRORS = {
  invalid_credentials: {
    httpStatus: 401,
    message: "Email or password is incorrect.",
    retryable: true,
  },
  account_locked: {
    httpStatus: 423,
    message: "Your account is temporarily locked. Please try again later.",
    retryable: false,
  },
  email_not_verified: {
    httpStatus: 403,
    message: "Please verify your email address before signing in.",
    retryable: false,
  },
  password_too_weak: {
    httpStatus: 422,
    message: "That password does not meet the security requirements.",
    retryable: false,
  },
  password_reused: {
    httpStatus: 422,
    message: "Please choose a password you have not used before.",
    retryable: false,
  },
  reset_token_invalid: {
    httpStatus: 400,
    message: "This reset link is invalid.",
    retryable: false,
  },
  reset_token_expired: {
    httpStatus: 410,
    message: "This reset link has expired. Please request a new one.",
    retryable: false,
  },
  verification_token_invalid: {
    httpStatus: 400,
    message: "This verification link is invalid.",
    retryable: false,
  },
  verification_token_expired: {
    httpStatus: 410,
    message: "This verification link has expired. Please request a new one.",
    retryable: false,
  },
  totp_required: {
    httpStatus: 401,
    message: "Two-factor authentication is required.",
    retryable: false,
  },
  totp_invalid: {
    httpStatus: 401,
    message: "That verification code is invalid.",
    retryable: true,
  },
  backup_code_invalid: {
    httpStatus: 401,
    message: "That backup code is invalid.",
    retryable: true,
  },
  backup_code_spent: {
    httpStatus: 409,
    message: "That backup code has already been used.",
    retryable: false,
  },
  session_revoked: {
    httpStatus: 401,
    message: "This session has been signed out.",
    retryable: false,
  },
  session_expired: {
    httpStatus: 401,
    message: "This session has expired. Please sign in again.",
    retryable: false,
  },
  token_signature_invalid: {
    httpStatus: 401,
    message: "The token signature is invalid.",
    retryable: false,
  },
  jwks_key_unknown: {
    httpStatus: 401,
    message: "The token was signed with an unknown key.",
    retryable: false,
  },
  rate_limited: {
    httpStatus: 429,
    message: "Too many attempts. Please slow down.",
    retryable: true,
  },
  oauth_state_mismatch: {
    httpStatus: 400,
    message: "The sign-in request could not be verified. Please try again.",
    retryable: false,
  },
  oauth_account_not_linked: {
    httpStatus: 409,
    message: "This account could not be linked. Please try another sign-in method.",
    retryable: false,
  },
} as const;

export type AuthErrorCode = keyof typeof AUTH_ERRORS;

export interface AuthError {
  code: AuthErrorCode;
  httpStatus: number;
  message: string;
  retryable: boolean;
}

export function authError(code: AuthErrorCode): AuthError {
  return { code, ...AUTH_ERRORS[code] };
}
