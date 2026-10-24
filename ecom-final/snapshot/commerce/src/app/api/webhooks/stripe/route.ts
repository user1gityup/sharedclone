export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getStripeClient, getStripeWebhookSecret } from "@/lib/stripe";
import { claimPaymentRequest, confirmOrderPayment } from "@/lib/paymentConfirm";

export async function POST(request: NextRequest) {
  const stripe = await getStripeClient();
  const webhookSecret = await getStripeWebhookSecret();

  // Mock/sandbox mode: accept the webhook and return 200
  if (!stripe || !webhookSecret) {
    return NextResponse.json({ received: true, mode: "sandbox" });
  }

  const sig = request.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "Missing stripe-signature" }, { status: 400 });

  const body = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Handle payment_intent.succeeded
  if (event.type === "payment_intent.succeeded") {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    const orderId = paymentIntent.metadata.orderId;
    if (!orderId) return NextResponse.json({ received: true });

    // Find the payment request by Stripe PI id
    const pr = await import("@/lib/prisma").then((m) => m.prisma);
    const paymentRequest = await pr.paymentRequest.findFirst({
      where: { stripePaymentIntentId: paymentIntent.id, status: "PENDING" },
    });
    if (!paymentRequest) return NextResponse.json({ received: true, note: "already processed" });

    // Atomic claim — prevents double-confirmation on webhook retry
    const claimed = await claimPaymentRequest(paymentRequest.nonce);
    if (claimed.status === "CONFIRMED" && claimed.confirmedAt && !paymentRequest.confirmedAt) {
      try {
        await confirmOrderPayment(claimed);
      } catch (err) {
        console.error("[stripe-webhook] confirmOrderPayment failed:", (err as Error).message);
      }
    }
  }

  return NextResponse.json({ received: true });
}
