// Compliance and licence types. Types and constants only: no imports, no
// runtime logic beyond frozen objects.

/** The compliance systems this repo supports (California = Metrc only). */
export type ComplianceSystem = "metrc";

/** The kinds of compliance check that can be recorded. */
export type ComplianceCheckKind = "pre_release" | "inventory_sync" | "transfer" | "sale_report";

/** One compliance check result, written whether the check passed or failed. */
export interface ComplianceRecord {
  /** Stable record id. */
  id: string;
  /** The order this check ran against. */
  orderId: string;
  /** Which compliance system performed the check. */
  system: ComplianceSystem;
  /** What kind of check was run. */
  kind: ComplianceCheckKind;
  /** The raw request body sent to the compliance system. */
  requestBody: unknown;
  /** The raw response body received from the compliance system. */
  responseBody: unknown;
  /** True when the check passed. */
  passed: boolean;
  /** Human-readable reason when the check failed. */
  failureReason?: string;
  /** ISO-8601 UTC timestamp of the check. */
  checkedAt: string;
  /** How many times this check has been retried. */
  retryCount: number;
}

export type LicenceVerificationStatus = "unverified" | "pending" | "verified" | "expired" | "revoked";

/** A state-issued cannabis licence captured during vendor vetting. */
export interface CannabisLicence {
  /** Stable licence id. */
  id: string;
  /** The vendor this licence belongs to. */
  vendorId: string;
  /** The licence number as printed by the issuing state. */
  licenceNumber: string;
  /** Two-letter uppercase issuing state, e.g. "CA". */
  issuingState: string;
  /** The licence category (cultivation, retail, distribution, ...). */
  licenceType: string;
  /** ISO-8601 UTC date the licence was issued. */
  issuedAt: string;
  /** ISO-8601 UTC date the licence expires. */
  expiresAt: string;
  /** Current verification status. */
  verificationStatus: LicenceVerificationStatus;
  /** ISO-8601 UTC timestamp the licence was last verified. */
  verifiedAt?: string;
}

/**
 * Licence verification statuses that block ordering. A buyer whose only licence
 * is in one of these states cannot place a B2B wholesale order.
 */
export const LICENCE_TERMINAL_STATUSES: readonly LicenceVerificationStatus[] = Object.freeze([
  "expired",
  "revoked",
]);

/** True when the given licence status blocks ordering. */
export function licenceBlocksOrdering(status: LicenceVerificationStatus): boolean {
  return LICENCE_TERMINAL_STATUSES.includes(status);
}
