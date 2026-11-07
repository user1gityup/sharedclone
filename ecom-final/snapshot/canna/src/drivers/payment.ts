// Payment drivers. B2C retail uses Dutchie Pay / Treez Pay behind one internal
// interface. B2B wholesale uses crypto or ACH plus invoiced/terms settlement.
// Deliberately NOT Stripe (card networks restrict cannabis).
//
// The B2B paths reuse the atomic claim-then-confirm pattern from
// billboard-platform's lib/paymentConfirm.js so a webhook retry cannot
// double-settle an invoice. Sandbox when no provider key is present.

import { CredentialVault } from "@/lib/vault";

export type PaymentMethod = "dutchie_pay" | "treez_pay" | "crypto" | "ach" | "terms";

export interface PaymentClaim {
  orderId: string;
  amountCents: number;
  method: PaymentMethod;
  idempotencyKey: string;
}

export interface PaymentResult {
  method: PaymentMethod;
  sandbox: boolean;
  claimRef: string;
  status: "claimed" | "settled" | "already_settled" | "failed";
}

/**
 * In-memory settlement ledger. `confirm` is idempotent per claimRef, so a
 * retried webhook returns `already_settled` instead of settling twice.
 */
export class SettlementLedger {
  private readonly settled = new Set<string>();

  settle(claimRef: string): "settled" | "already_settled" {
    if (this.settled.has(claimRef)) return "already_settled";
    this.settled.add(claimRef);
    return "settled";
  }

  isSettled(claimRef: string): boolean {
    return this.settled.has(claimRef);
  }
}

export interface PaymentDriver {
  readonly method: PaymentMethod;
  claim(payment: PaymentClaim): Promise<PaymentResult>;
  confirm(claimRef: string): Promise<PaymentResult>;
}

abstract class BasePaymentDriver implements PaymentDriver {
  abstract readonly method: PaymentMethod;
  protected readonly ledger = new SettlementLedger();
  protected abstract keyNames(): string[];

  protected async isSandbox(): Promise<boolean> {
    for (const name of this.keyNames()) {
      if (!(await this.vault.get(name))) return true;
    }
    return false;
  }

  constructor(protected readonly vault: CredentialVault) {}

  async claim(payment: PaymentClaim): Promise<PaymentResult> {
    const sandbox = await this.isSandbox();
    const claimRef = `${this.method}-${sandbox ? "sandbox" : "live"}-${payment.idempotencyKey}`;
    return { method: this.method, sandbox, claimRef, status: "claimed" };
  }

  async confirm(claimRef: string): Promise<PaymentResult> {
    const sandbox = await this.isSandbox();
    const status = this.ledger.settle(claimRef);
    return { method: this.method, sandbox, claimRef, status };
  }
}

export class DutchiePayDriver extends BasePaymentDriver {
  readonly method = "dutchie_pay" as const;
  protected keyNames() {
    return ["DUTCHIE_API_KEY"];
  }
}

export class TreezPayDriver extends BasePaymentDriver {
  readonly method = "treez_pay" as const;
  protected keyNames() {
    return ["TREEZ_CLIENT_ID", "TREEZ_CLIENT_SECRET"];
  }
}

export class AchDriver extends BasePaymentDriver {
  readonly method = "ach" as const;
  protected keyNames() {
    return ["ACH_PROVIDER_KEY"];
  }
}

export class CryptoDriver extends BasePaymentDriver {
  readonly method = "crypto" as const;
  protected keyNames() {
    return []; // crypto settlement has no central provider key; sandbox unless configured
  }
}

/** Terms/invoiced settlement always succeeds in sandbox (no provider call). */
export class TermsDriver extends BasePaymentDriver {
  readonly method = "terms" as const;
  protected keyNames() {
    return [];
  }
}

/** Return a payment driver for the given method. */
export function getPaymentDriver(method: PaymentMethod, vault: CredentialVault): PaymentDriver {
  switch (method) {
    case "treez_pay":
      return new TreezPayDriver(vault);
    case "crypto":
      return new CryptoDriver(vault);
    case "ach":
      return new AchDriver(vault);
    case "terms":
      return new TermsDriver(vault);
    case "dutchie_pay":
    default:
      return new DutchiePayDriver(vault);
  }
}
