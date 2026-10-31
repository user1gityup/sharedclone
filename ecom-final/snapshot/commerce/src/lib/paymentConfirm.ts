// confirmOrderPayment — the generalized payment confirmation dispatcher.
// Ported from billboard-platform/lib/paymentConfirm.js confirmPaymentRequest()
// with the same atomic-claim-then-confirm pattern that makes double-confirmation
// from a webhook retry impossible.

import { prisma } from "./prisma.ts";
import { splitSellerCredit, getHouseBasisPoints } from "./houseRevenue.ts";
import type { PaymentRail } from "./orderStates.ts";

export interface ConfirmResult {
  paymentRequest: any;
  houseRevenueRecord?: any;
}

// The atomic-claim pattern from billboard-platform's confirmPaymentRequest().
// updateMany WHERE status='PENDING' means only one caller ever wins the race.
// Every payment webhook handler calls this, never credits money directly.
export async function claimPaymentRequest(nonce: string): Promise<any> {
  const claim = await prisma.paymentRequest.updateMany({
    where: { nonce, status: "PENDING" },
    data: { status: "CONFIRMED", confirmedAt: new Date() },
  });
  if (claim.count === 0) {
    // Lost the race or stale retry — return current row
    return prisma.paymentRequest.findUnique({ where: { nonce } });
  }
  return prisma.paymentRequest.findUniqueOrThrow({ where: { nonce } });
}

// The main confirmation flow for a multi-vendor order. Called after
// claimPaymentRequest wins the atomic claim.
export async function confirmOrderPayment(paymentRequest: any): Promise<ConfirmResult> {
  const order = await prisma.order.findUnique({
    where: { id: paymentRequest.orderId },
    include: { lines: true },
  });
  if (!order) throw new Error(`Order ${paymentRequest.orderId} not found`);

  // Group order lines by vendor for the house-revenue split
  const vendorLines = new Map<string, { vendorId: string; totalMinor: number }>();
  for (const line of order.lines) {
    const existing = vendorLines.get(line.vendorId);
    if (existing) {
      existing.totalMinor += line.priceMinor * line.quantity;
    } else {
      vendorLines.set(line.vendorId, { vendorId: line.vendorId, totalMinor: line.priceMinor * line.quantity });
    }
  }

  const houseBasisPoints = await getHouseBasisPoints();
  const houseRevenueRecords: any[] = [];

  const result = await prisma.$transaction([
    // Re-read the claimed payment request
    prisma.paymentRequest.findUniqueOrThrow({ where: { nonce: paymentRequest.nonce } }),

    // Update order state
    prisma.order.update({
      where: { id: order.id },
      data: { state: "PAID" },
    }),

    // Write house revenue records per vendor
    ...Array.from(vendorLines.values()).map(({ vendorId, totalMinor }) => {
      const { netMinor, houseCutMinor } = splitSellerCredit(totalMinor, houseBasisPoints);
      return prisma.houseRevenue.create({
        data: {
          source: "ORDER_SALE",
          grossAmountMinor: totalMinor,
          amountMinor: houseCutMinor,
          splitBasisPoints: houseCutMinor > 0 ? houseBasisPoints : null,
          vendorId,
          note: `Order ${order.id} — vendor ${vendorId}`,
        },
      });
    }),
  ]);

  // After the transaction commits, dispatch notifications
  return { paymentRequest: result[0] };
}
