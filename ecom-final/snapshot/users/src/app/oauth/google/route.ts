import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { db } from "@/lib/db";
import { buildGoogleAuthUrl } from "@/lib/googleAuth";
import { getAppBaseUrl } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const state = db.oauthStates.issue("", 600);
  const redirectUri = `${getAppBaseUrl()}/oauth/google/callback`;
  const authUrl = buildGoogleAuthUrl({ redirectUri, state });
  if (!authUrl) {
    return jsonError("oauth_not_configured", 503, "Google OAuth is not configured.");
  }
  return NextResponse.redirect(authUrl);
}
