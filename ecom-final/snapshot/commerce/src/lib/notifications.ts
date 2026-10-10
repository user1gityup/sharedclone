// Notification dispatch — ported from billboard-platform/lib/notifications/dispatch.js
// In-memory mode (no email/push transports configured) by default, so the app
// starts and is clickable with zero credentials.

import { prisma } from "./prisma.ts";

export const EVENT_REGISTRY: Record<string, { type: string; label: string; description: string }> = {
  "order.placed": {
    type: "ORDER_PLACED",
    label: "Order placed",
    description: "A customer placed a new order.",
  },
  "order.confirmed_by_vendor": {
    type: "ORDER_CONFIRMED_BY_VENDOR",
    label: "Order confirmed by vendor",
    description: "A vendor confirmed they can fulfill part of an order.",
  },
  "order.shipped": {
    type: "ORDER_SHIPPED",
    label: "Order shipped",
    description: "A vendor marked part of an order as shipped.",
  },
  "payment.confirmed": {
    type: "PAYMENT_CONFIRMED",
    label: "Payment confirmed",
    description: "A payment was confirmed for an order.",
  },
  "vendor.application_approved": {
    type: "VENDOR_APPLICATION_APPROVED",
    label: "Vendor application approved",
    description: "An admin approved a vendor's onboarding application.",
  },
  "vendor.application_rejected": {
    type: "VENDOR_APPLICATION_REJECTED",
    label: "Vendor application rejected",
    description: "An admin rejected a vendor's onboarding application.",
  },
  "vendor.new_application": {
    type: "NEW_VENDOR_APPLICATION",
    label: "New vendor application",
    description: "A new vendor applied and needs admin review.",
  },
  "account.low_balance": {
    type: "ACCOUNT_LOW_BALANCE",
    label: "Account balance low",
    description: "A vendor's balance dropped below the configured threshold.",
  },
};

export async function dispatchNotification(
  eventKey: string,
  opts: { userId?: string; title: string; body: string }
): Promise<{ recipients: string[] }> {
  const meta = EVENT_REGISTRY[eventKey];
  if (!meta) throw new Error(`Unknown eventKey "${eventKey}"`);

  if (!opts.userId) return { recipients: [] };

  // Always write an in-app notification row
  await prisma.notification.create({
    data: {
      userId: opts.userId,
      type: meta.type as any,
      title: opts.title,
      body: opts.body,
    },
  });

  // Email/push transports are skipped unless explicitly configured —
  // the app starts clickable with zero credentials.
  return { recipients: [opts.userId] };
}
