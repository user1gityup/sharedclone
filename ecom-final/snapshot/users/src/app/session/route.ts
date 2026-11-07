import { NextResponse } from "next/server";
import { json, jsonError, authErrorResponse } from "@/lib/http";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/crypto";
import { issueTokens } from "@/lib/auth";
import { clientIp } from "@/lib/clientIp";
import { checkRateLimit } from "@/lib/rateLimit";
import { getTrustedProxyCount } from "@/lib/config";
import { toPublicUser } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const ip = clientIp({ headers: request.headers }, getTrustedProxyCount());
  const rl = checkRateLimit(`login:${ip}`, Date.now(), 10);
  if (!rl.allowed) return authErrorResponse("rate_limited");

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return jsonError("invalid_request", 400, "Request body must be JSON.");
  }
  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) {
    return jsonError("invalid_request", 400, "email and password are required.");
  }

  const user = await db.users.findByEmail(email);
  // Never reveal whether the email exists; both branches return the same error.
  if (!user || !user.passwordHash) return authErrorResponse("invalid_credentials");
  if (!verifyPassword(password, user.passwordHash)) {
    return authErrorResponse("invalid_credentials");
  }

  if (user.totpSecret) {
    const challengeToken = db.totpChallenges.issue(user.id, 300);
    return json({ error: "totp_required", challengeToken }, 401);
  }

  const aud = typeof body.aud === "string" ? body.aud : undefined;
  const tokens = issueTokens({ user, aud, amr: ["pwd"] });
  return json({ user: toPublicUser(user), tokens });
}
