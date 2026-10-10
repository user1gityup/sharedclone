import { NextResponse } from "next/server";
import { json, jsonError, authErrorResponse } from "@/lib/http";
import { db } from "@/lib/db";
import { issueTokens } from "@/lib/auth";
import { exchangeMetaCode, fetchMetaProfile } from "@/lib/metaAuth";
import { getAppBaseUrl } from "@/lib/config";
import { toPublicUser, type User } from "@/lib/types";

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
    const tokenResponse = await exchangeMetaCode({
      code,
      redirectUri: `${getAppBaseUrl()}/oauth/meta/callback`,
    });
    profile = await fetchMetaProfile(tokenResponse.access_token);
  } catch {
    return jsonError("oauth_failed", 502, "OAuth sign-in failed.");
  }

  if (!profile.id) {
    return jsonError("oauth_failed", 502, "OAuth sign-in failed.");
  }

  // No email on the Meta profile -> never match; create a fresh account.
  let user: User | null = null;
  if (profile.email) {
    user = await db.users.findByEmail(profile.email);
  }

  if (!user) {
    user = await db.users.create({
      email: profile.email || `fb-${profile.id}@meta.users.invalid`,
      passwordHash: null,
      name: profile.name ?? null,
      picture: null,
      emailVerified: false,
    });
  }

  const tokens = issueTokens({ user, amr: ["oauth"], authTime: Math.floor(Date.now() / 1000) });
  return json({ user: toPublicUser(user), tokens });
}
