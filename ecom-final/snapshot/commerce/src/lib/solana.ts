// Solana Pay engine, ported from billboard-platform/lib/solana.js
// DEVNET ONLY.

import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { getSetting } from "./settings.ts";

let connection: Connection | null = null;
let connectionUrl: string | null = null;

export async function getConnection(): Promise<Connection> {
  const rpcUrl = (await getSetting("SOLANA_RPC_URL")) || clusterApiUrl("devnet");
  if (!connection || connectionUrl !== rpcUrl) {
    connection = new Connection(rpcUrl, "confirmed");
    connectionUrl = rpcUrl;
  }
  return connection;
}

export async function getMerchantPublicKey(): Promise<PublicKey | null> {
  const raw = await getSetting("SOLANA_TREASURY_PUBKEY");
  if (!raw) return null;
  return new PublicKey(raw);
}

export function generateReference(): string {
  const { Keypair } = require("@solana/web3.js");
  return Keypair.generate().publicKey.toBase58();
}

const DEVNET_USD_PER_SOL = 20;

export function usdToLamports(amountUsd: number): number {
  return Math.round((amountUsd / DEVNET_USD_PER_SOL) * 1e9);
}

export function usdToTokenAmount(amountUsd: number, decimals: number): number {
  return Math.round(amountUsd * 10 ** decimals);
}

export function buildSolanaPayUrl(params: {
  recipient: string;
  amountUsd: number;
  method: "SOL" | "USDC_SOL";
  mintAddress?: string;
  reference: string;
  label?: string;
  message?: string;
}): string {
  const { recipient, amountUsd, method, mintAddress, reference, label, message } = params;
  const amount =
    method === "SOL"
      ? (usdToLamports(amountUsd) / 1e9)
          .toFixed(9)
          .replace(/0+$/, "")
          .replace(/\.$/, "")
      : (usdToTokenAmount(amountUsd, 6) / 1e6)
          .toFixed(6)
          .replace(/0+$/, "")
          .replace(/\.$/, "");

  const qs = new URLSearchParams();
  qs.set("amount", amount);
  if (method === "USDC_SOL" && mintAddress) qs.set("spl-token", mintAddress);
  qs.set("reference", reference);
  if (label) qs.set("label", label);
  if (message) qs.set("message", message);

  return `solana:${recipient}?${qs.toString()}`;
}

export async function buildSolanaPaymentPayload(method: "SOL" | "USDC_SOL", amountUsd: number, reference: string) {
  const merchant = await getMerchantPublicKey();
  const recipient = merchant ? merchant.toBase58() : null;
  const mint = (await getSetting("USDC_MINT_ADDRESS")) || null;

  const payload: Record<string, unknown> = {
    recipient,
    reference,
    cluster: "devnet",
    ...(method === "SOL"
      ? { lamports: usdToLamports(amountUsd) }
      : { mint, tokenAmount: usdToTokenAmount(amountUsd, 6) }),
  };

  const ready = recipient && (method !== "USDC_SOL" || mint);
  if (ready) {
    payload.url = buildSolanaPayUrl({
      recipient,
      amountUsd,
      method,
      mintAddress: mint || undefined,
      reference,
      label: "Commerce",
      message: `Commerce payment — $${(amountUsd / 100).toLocaleString()}`,
    });
  }

  return payload;
}

export async function findAndValidateSolanaPayment(params: {
  reference: string;
  method: string;
  amountUsd: number;
}): Promise<{ found: boolean; verified?: boolean; signature?: string }> {
  const conn = await getConnection();
  const referenceKey = new PublicKey(params.reference);

  const signatures = await conn.getSignaturesForAddress(referenceKey, { limit: 1000 }, "confirmed");
  if (signatures.length === 0) return { found: false };

  const ordered = [...signatures].sort((a, b) => (a.blockTime || 0) - (b.blockTime || 0));

  for (const { signature } of ordered) {
    const tx = await conn.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0 });
    if (!tx || tx.meta?.err) continue;

    // Check that the transaction contains a transfer to the merchant
    const merchant = await getMerchantPublicKey();
    if (!merchant) continue;

    const instructions = tx.transaction.message.instructions;
    for (const ix of instructions) {
      if ((ix as any).program !== "system" || (ix as any).parsed?.type !== "transfer") continue;
      const info = (ix as any).parsed.info;
      if (info.destination === merchant.toBase58() && info.lamports >= usdToLamports(params.amountUsd)) {
        return { found: true, verified: true, signature };
      }
    }
  }

  return { found: true, verified: false };
}
