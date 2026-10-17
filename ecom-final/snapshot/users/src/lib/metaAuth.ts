/**
 * Meta (Facebook) OAuth 2.0 Authorization Code flow (no SDK, plain fetch).
 * Ported from billboard-platform/lib/metaAuth.js, reading credentials from the
 * environment. Mirrors googleAuth.ts's shape.
 *
 * Security note: Meta's Graph API exposes no `email_verified` signal, and `email`
 * may be absent. Resolution is therefore conservative: a missing email always
 * creates a new account rather than attempting an email match (see the callback
 * route).
 */

const META_AUTH_URL = "https://www.facebook.com/v19.0/dialog/oauth";
const META_TOKEN_URL = "https://graph.facebook.com/v19.0/oauth/access_token";
const META_PROFILE_URL = "https://graph.facebook.com/me";

export interface MetaProfile {
  id: string;
  name?: string;
  email?: string;
}

export function getMetaOAuthConfig(): {
  appId: string;
  appSecret: string;
} | null {
  const appId = process.env.META_OAUTH_CLIENT_ID;
  const appSecret = process.env.META_OAUTH_CLIENT_SECRET;
  if (!appId || !appSecret) return null;
  return { appId, appSecret };
}

export function buildMetaAuthUrl(params: {
  redirectUri: string;
  state: string;
}): string | null {
  const config = getMetaOAuthConfig();
  if (!config) return null;

  const q = new URLSearchParams({
    client_id: config.appId,
    redirect_uri: params.redirectUri,
    state: params.state,
    scope: "email,public_profile",
    response_type: "code",
  });
  return `${META_AUTH_URL}?${q.toString()}`;
}

export async function exchangeMetaCode(params: {
  code: string;
  redirectUri: string;
}): Promise<{ access_token: string }> {
  const config = getMetaOAuthConfig();
  if (!config) throw new Error("Meta OAuth is not configured");

  const q = new URLSearchParams({
    client_id: config.appId,
    client_secret: config.appSecret,
    redirect_uri: params.redirectUri,
    code: params.code,
  });
  const res = await fetch(`${META_TOKEN_URL}?${q.toString()}`);
  if (!res.ok) throw new Error(`Meta token exchange failed (${res.status})`);
  return res.json() as Promise<{ access_token: string }>;
}

export async function fetchMetaProfile(accessToken: string): Promise<MetaProfile> {
  const q = new URLSearchParams({ fields: "id,name,email", access_token: accessToken });
  const res = await fetch(`${META_PROFILE_URL}?${q.toString()}`);
  if (!res.ok) throw new Error(`Meta profile fetch failed (${res.status})`);
  return res.json() as Promise<MetaProfile>;
}
