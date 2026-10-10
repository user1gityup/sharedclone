import { NextResponse } from "next/server";
import { json, jsonError, authErrorResponse } from "@/lib/http";
import { db } from "@/lib/db";
import { issueTokens } from "@/lib/auth";
import { exchangeGoogleCode, fetchGoogleProfile } from "@/lib/googleAuth";
import { getAppBaseUrl } from "@/lib/config";
import { toPublicUser } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  if (!state) return authErrorResponse("oauth_state_mismatch");

  const stateValue = db.oauthStates.consume(state);
  if (stateValue === null) return authErrorResponse("oauth_state_mismatch");

  let profile;
  try {
    const tokenResponse = await exchangeGoogleCode({
      code,
      redirectUri: `${getAppBaseUrl()}/oauth/google/callback`,
    });
    profile = await fetchGoogleProfile(tokenResponse.access_token);
  } catch {
    return jsonError("oauth_failed", 502, "OAuth sign-in failed.");
  }

  if (!profile.sub || !profile.email) {
    return jsonError("oauth_failed", 502, "OAuth sign-in failed.");
  }

  let user = await db.users.findByEmail(profile.email);
  if (user && profile.email_verified === false) {
    return authErrorResponse("oauth_account_not_linked");
  }

  if (!user) {
    user = await db.users.create({
      email: profile.email,
      passwordHash: null,
      name: profile.name ?? null,
      picture: profile.picture ?? null,
      emailVerified: profile.email_verified ?? false,
    });
  } else if (profile.email_verified === true && !user.emailVerified) {
    await db.users.update(user.id, { emailVerified: true });
  }

  const tokens = issueTokens({ user, amr: ["oauth"], authTime: Math.floor(Date.now() / 1000) });
  return json({ user: toPublicUser(user), tokens });
}
