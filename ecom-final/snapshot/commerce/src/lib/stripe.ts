// Payment engine: Stripe client, ported from billboard-platform/lib/stripe.js

import Stripe from "stripe";
import { getSetting } from "./settings.ts";

let client: Stripe | null = null;
let clientKey: string | null = null;

// Returns null when STRIPE_SECRET_KEY isn't set, so callers degrade to
// mock/sandbox mode. No credentials = app still starts and is clickable.
export async function getStripeClient(): Promise<Stripe | null> {
  const secretKey = await getSetting("STRIPE_SECRET_KEY");
  if (!secretKey) return null;
  if (!client || clientKey !== secretKey) {
    client = new Stripe(secretKey, { apiVersion: "2024-06-20" as any });
    clientKey = secretKey;
  }
  return client;
}

export async function getStripeWebhookSecret(): Promise<string | null> {
  return getSetting("STRIPE_WEBHOOK_SECRET");
}
