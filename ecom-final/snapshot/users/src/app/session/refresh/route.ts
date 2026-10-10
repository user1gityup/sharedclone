import { NextResponse } from "next/server";
import { json, jsonError } from "@/lib/http";
import { refreshSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.json().catch(() => null);
  const refreshToken =
    body && typeof body === "object" && typeof body.refreshToken === "string"
      ? body.refreshToken
      : "";
  if (!refreshToken) {
    return jsonError("invalid_request", 400, "refreshToken is required.");
  }

  const tokens = await refreshSession(refreshToken);
  if (!tokens) {
    return jsonError("invalid_refresh_token", 401, "The refresh token is invalid or expired.");
  }
  return json(tokens);
}
