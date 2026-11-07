import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { db } from "@/lib/db";

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

  db.sessions.revokeByRefreshToken(refreshToken);
  return new NextResponse(null, { status: 204 });
}
