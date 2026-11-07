// Pure Stripe Connect helpers, ported from billboard-platform/lib/stripeConnect.js

export type ConnectStatus = "not_started" | "in_progress" | "ready";

export function classifyConnectStatus(account: { payouts_enabled?: boolean } | null): ConnectStatus {
  if (!account) return "not_started";
  return account.payouts_enabled ? "ready" : "in_progress";
}

export function connectOnboardingLinkParams(accountId: string, origin: string) {
  return {
    account: accountId,
    type: "account_onboarding" as const,
    return_url: `${origin}/api/payouts/connect/return`,
    refresh_url: `${origin}/api/payouts/connect/refresh`,
  };
}
