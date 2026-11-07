// Frozen machine-readable error codes for the canna storefront.
// These match the `{ error, error_description }` shape in USERS-CONTRACT.md §8.

export const ERROR_CODES = Object.freeze({
  // session verification
  MISSING_TOKEN: "missing_token",
  MALFORMED_TOKEN: "malformed_token",
  UNSUPPORTED_ALG: "unsupported_alg",
  UNSUPPORTED_TYP: "unsupported_typ",
  UNSUPPORTED_KEY: "unsupported_key",
  MISSING_KID: "missing_kid",
  INVALID_SIGNATURE: "invalid_signature",
  INVALID_CLAIMS: "invalid_claims",
  NONCE_MISMATCH: "nonce_mismatch",
  TOKEN_EXPIRED: "token_expired",
  REVOKED: "revoked",
  INSUFFICIENT_AMR: "insufficient_amr",
  FORBIDDEN: "forbidden",

  // commerce
  NOT_FOUND: "not_found",
  OUT_OF_STOCK: "out_of_stock",
  INVALID_STATE_TRANSITION: "invalid_state_transition",
  LICENCE_REQUIRED: "licence_required",
  COMPLIANCE_FAILED: "compliance_failed",
  PAYMENT_FAILED: "payment_failed",
  ALREADY_SETTLED: "already_settled",

  // vault
  VAULT_INVALID_INPUT: "vault_invalid_input",
  VAULT_INVALID_CIPHERTEXT: "vault_invalid_ciphertext",

  // generic
  RATE_LIMITED: "rate_limited",
  VALIDATION_FAILED: "validation_failed",
  INTERNAL: "internal",
} as const);

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
