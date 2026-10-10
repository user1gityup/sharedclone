/**
 * Environment access for the users service. Read from `process.env` with sane
 * defaults so the service runs without any configuration in development.
 */

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

export function getIssuer(): string {
  return process.env.SESSION_ISSUER || "http://localhost:3000";
}

export function getDefaultAudience(): string {
  return process.env.SESSION_AUDIENCE || "storefront";
}

export function getSessionTtlSeconds(): number {
  return Math.max(60, envInt("SESSION_TTL_SECONDS", 900));
}

export function getRefreshTtlSeconds(): number {
  return Math.max(3600, envInt("REFRESH_TTL_SECONDS", 60 * 60 * 24 * 30));
}

export function getTrustedProxyCount(): number {
  return Math.max(1, envInt("RATE_LIMIT_TRUSTED_PROXY_COUNT", 1));
}

export function getTotpIssuer(): string {
  return process.env.TOTP_ISSUER || "users";
}

export function getAppBaseUrl(): string {
  return process.env.APP_BASE_URL || process.env.SESSION_ISSUER || "http://localhost:3000";
}
