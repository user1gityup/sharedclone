import { NextResponse } from "next/server";
import { json, jsonError } from "@/lib/http";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const claims = requireUser(request);
  if (!claims) {
    return jsonError("unauthorized", 401, "A valid bearer token is required.");
  }

  return json({
    sub: claims.sub,
    email: claims.email ?? null,
    email_verified: claims.email_verified ?? false,
    name: claims.name ?? null,
    picture: claims.picture ?? null,
  });
}
