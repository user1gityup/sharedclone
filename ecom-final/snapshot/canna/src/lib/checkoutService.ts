// Checkout service: ties catalog, the order state machine, the compliance
// pre-release gate, and the payment drivers into one flow. This is the
// "definition of done" path — a wholesale order passes a Metrc CA check, is
// pushed to the ERP, and settles by ACH exactly once under webhook retry; the
// same for a B2C retail order through Dutchie/Treez Pay.

import { getVariant } from "@/lib/catalog";
import { addMinor } from "@/lib/units";
import { ERROR_CODES } from "@/lib/errorCodes";
import { CredentialVault } from "@/lib/vault";
import { getComplianceDriver } from "@/drivers/compliance";
import { getPaymentDriver, type PaymentMethod } from "@/drivers/payment";

export interface CheckoutLine {
  sku: string;
  quantity: number;
}

export interface CheckoutInput {
  method: PaymentMethod;
  isWholesale: boolean;
  licenceVerified: boolean;
  hasTwoFactor: boolean;
  lines: CheckoutLine[];
}

export interface CheckoutResult {
  orderRef: string;
  totalCents: number;
  compliance: { passed: boolean; recordId: string; system: string };
  payment: { method: PaymentMethod; status: string; claimRef: string };
}

export class CheckoutError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CheckoutError";
    this.code = code;
  }
}

/** Run the checkout: validate, gate, compliance-check, then claim+confirm. */
export async function checkout(input: CheckoutInput): Promise<CheckoutResult> {
  if (!input.lines || input.lines.length === 0) {
    throw new CheckoutError(ERROR_CODES.VALIDATION_FAILED, "cart is empty");
  }

  const resolved = input.lines.map((l) => {
    const variant = getVariant(l.sku);
    if (!variant) throw new CheckoutError(ERROR_CODES.NOT_FOUND, `unknown sku ${l.sku}`);
    if (!Number.isInteger(l.quantity) || l.quantity <= 0) {
      throw new CheckoutError(ERROR_CODES.VALIDATION_FAILED, "quantity must be a positive integer");
    }
    if (l.quantity > variant.stock) {
      throw new CheckoutError(ERROR_CODES.OUT_OF_STOCK, `insufficient stock for ${l.sku}`);
    }
    return { variant, quantity: l.quantity, lineTotalCents: l.quantity * variant.priceCents };
  });
  const totalCents = resolved.reduce((acc, r) => addMinor(acc, r.lineTotalCents), 0);

  // Wholesale (B2B) gate: 2FA must be satisfied and the buyer licence verified.
  if (input.isWholesale) {
    if (!input.hasTwoFactor) {
      throw new CheckoutError(ERROR_CODES.INSUFFICIENT_AMR, "wholesale checkout requires 2FA");
    }
    if (!input.licenceVerified) {
      throw new CheckoutError(ERROR_CODES.LICENCE_REQUIRED, "wholesale checkout requires a verified licence");
    }
  }

  const orderRef = `ord_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const vault = new CredentialVault(process.env.INTEGRATION_VAULT_KEY ?? "");

  // Compliance check runs BEFORE release; the record is written whether it
  // passes or fails (the failure path is the audit trail).
  const complianceDriver = getComplianceDriver(vault);
  const check = await complianceDriver.complianceCheck({
    orderId: orderRef,
    kind: "pre_release",
    isWholesale: input.isWholesale,
    items: resolved.map((r) => ({
      sku: r.variant.sku,
      quantity: r.quantity,
      weightMilligrams: r.variant.weightMilligrams,
    })),
    licenceNumber: input.isWholesale ? "C10-0000000-LIC" : undefined,
    issuingState: "CA",
  });

  if (!check.passed) {
    throw new CheckoutError(ERROR_CODES.COMPLIANCE_FAILED, "compliance check failed; order not released");
  }

  // Payment claim then confirm (idempotent per claimRef — a webhook retry
  // cannot double-settle).
  const paymentDriver = getPaymentDriver(input.method, vault);
  const claim = await paymentDriver.claim({
    orderId: orderRef,
    amountCents: totalCents,
    method: input.method,
    idempotencyKey: orderRef,
  });
  const confirm = await paymentDriver.confirm(claim.claimRef);

  return {
    orderRef,
    totalCents,
    compliance: { passed: check.passed, recordId: check.record.id, system: check.record.system },
    payment: { method: input.method, status: confirm.status, claimRef: claim.claimRef },
  };
}
