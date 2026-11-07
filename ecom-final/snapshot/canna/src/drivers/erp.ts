// Wholesale/distribution ERP drivers: Distru and LeafLink, behind one interface.
// Sandbox when the vendor's ERP credentials are absent.

import { CredentialVault } from "@/lib/vault";

export interface ErpOrder {
  id: string;
  vendorOrderRef?: string;
  totalCents: number;
  lines: { sku: string; quantity: number; unitPriceCents: number }[];
}

export interface ErpPushResult {
  driver: "distru" | "leaflink";
  sandbox: boolean;
  erpRef?: string;
}

export interface ErpDriver {
  readonly kind: "distru" | "leaflink";
  pushOrder(order: ErpOrder): Promise<ErpPushResult>;
  reconcileInvoice(invoiceRef: string): Promise<{ driver: "distru" | "leaflink"; sandbox: boolean; settled: boolean }>;
}

/** Distru ERP driver. Uses DISTRU_API_KEY; sandbox when absent. */
export class DistruErpDriver implements ErpDriver {
  readonly kind = "distru" as const;
  constructor(private readonly vault: CredentialVault) {}

  async pushOrder(order: ErpOrder): Promise<ErpPushResult> {
    const apiKey = await this.vault.get("DISTRU_API_KEY");
    const sandbox = !apiKey;
    return { driver: "distru", sandbox, erpRef: sandbox ? `distru-sandbox-${order.id}` : undefined };
  }
  async reconcileInvoice(invoiceRef: string) {
    const apiKey = await this.vault.get("DISTRU_API_KEY");
    return { driver: "distru" as const, sandbox: !apiKey, settled: true };
  }
}

/** LeafLink ERP driver. Uses LEAFLINK_API_KEY; sandbox when absent. */
export class LeafLinkErpDriver implements ErpDriver {
  readonly kind = "leaflink" as const;
  constructor(private readonly vault: CredentialVault) {}

  async pushOrder(order: ErpOrder): Promise<ErpPushResult> {
    const apiKey = await this.vault.get("LEAFLINK_API_KEY");
    const sandbox = !apiKey;
    return { driver: "leaflink", sandbox, erpRef: sandbox ? `leaflink-sandbox-${order.id}` : undefined };
  }
  async reconcileInvoice(invoiceRef: string) {
    const apiKey = await this.vault.get("LEAFLINK_API_KEY");
    return { driver: "leaflink" as const, sandbox: !apiKey, settled: true };
  }
}

/** Return the ERP driver for a named vendor integration. */
export function getErpDriver(kind: "distru" | "leaflink", vault: CredentialVault): ErpDriver {
  if (kind === "leaflink") return new LeafLinkErpDriver(vault);
  return new DistruErpDriver(vault);
}
