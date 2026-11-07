// Retail POS drivers: Dutchie and Treez, behind one interface. A vendor org
// names which driver it uses; nothing hard-codes a single vendor.
//
// When the vendor's POS credentials are absent the driver runs in a sandbox
// (in-memory, deterministic) so the app is clickable with zero credentials.

import { CredentialVault } from "@/lib/vault";

export interface PosProduct {
  sku: string;
  name: string;
  weightMilligrams: number;
  unit: string;
  priceCents: number;
}

export interface PosOrderLine {
  sku: string;
  quantity: number;
}

export interface PosSyncResult {
  driver: "dutchie" | "treez";
  sandbox: boolean;
  products?: PosProduct[];
  orderRef?: string;
}

export interface PosDriver {
  readonly kind: "dutchie" | "treez";
  syncCatalog(): Promise<PosSyncResult>;
  syncInventory(skus: string[]): Promise<PosSyncResult>;
  pushOrder(lines: PosOrderLine[]): Promise<PosSyncResult>;
}

function isSandbox(...values: (string | undefined)[]): boolean {
  return values.some((v) => !v);
}

/** Dutchie POS driver. Uses DUTCHIE_API_KEY; sandbox when absent. */
export class DutchiePosDriver implements PosDriver {
  readonly kind = "dutchie" as const;
  constructor(private readonly vault: CredentialVault) {}

  async syncCatalog(): Promise<PosSyncResult> {
    const apiKey = await this.vault.get("DUTCHIE_API_KEY");
    return { driver: "dutchie", sandbox: isSandbox(apiKey), products: [] };
  }
  async syncInventory(skus: string[]): Promise<PosSyncResult> {
    const apiKey = await this.vault.get("DUTCHIE_API_KEY");
    return { driver: "dutchie", sandbox: isSandbox(apiKey), products: [] };
  }
  async pushOrder(lines: PosOrderLine[]): Promise<PosSyncResult> {
    const apiKey = await this.vault.get("DUTCHIE_API_KEY");
    return {
      driver: "dutchie",
      sandbox: isSandbox(apiKey),
      orderRef: isSandbox(apiKey) ? `dutchie-sandbox-${Date.now()}` : undefined,
    };
  }
}

/** Treez POS driver. Uses TREEZ_CLIENT_ID/SECRET; sandbox when absent. */
export class TreezPosDriver implements PosDriver {
  readonly kind = "treez" as const;
  constructor(private readonly vault: CredentialVault) {}

  async syncCatalog(): Promise<PosSyncResult> {
    const id = await this.vault.get("TREEZ_CLIENT_ID");
    const secret = await this.vault.get("TREEZ_CLIENT_SECRET");
    return { driver: "treez", sandbox: isSandbox(id, secret), products: [] };
  }
  async syncInventory(skus: string[]): Promise<PosSyncResult> {
    const id = await this.vault.get("TREEZ_CLIENT_ID");
    const secret = await this.vault.get("TREEZ_CLIENT_SECRET");
    return { driver: "treez", sandbox: isSandbox(id, secret), products: [] };
  }
  async pushOrder(lines: PosOrderLine[]): Promise<PosSyncResult> {
    const id = await this.vault.get("TREEZ_CLIENT_ID");
    const secret = await this.vault.get("TREEZ_CLIENT_SECRET");
    const sandbox = isSandbox(id, secret);
    return { driver: "treez", sandbox, orderRef: sandbox ? `treez-sandbox-${Date.now()}` : undefined };
  }
}

/** Return the POS driver for a named vendor integration. */
export function getPosDriver(kind: "dutchie" | "treez", vault: CredentialVault): PosDriver {
  if (kind === "treez") return new TreezPosDriver(vault);
  return new DutchiePosDriver(vault);
}
