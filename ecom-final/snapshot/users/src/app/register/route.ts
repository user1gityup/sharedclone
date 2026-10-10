import { NextResponse } from "next/server";
import { json, jsonError, authErrorResponse } from "@/lib/http";
import { db, EmailAlreadyExistsError } from "@/lib/db";
import { hashPassword } from "@/lib/crypto";
import { issueTokens } from "@/lib/auth";
import { checkPassword } from "@/lib/passwordPolicy";
import { clientIp } from "@/lib/clientIp";
import { checkRateLimit } from "@/lib/rateLimit";
import { getTrustedProxyCount } from "@/lib/config";
import { toPublicUser } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const ip = clientIp({ headers: request.headers }, getTrustedProxyCount());
  const rl = checkRateLimit(`register:${ip}`, Date.now(), 10);
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

  const policy = checkPassword(password, { email });
  if (!policy.ok) return authErrorResponse("password_too_weak");

  try {
    const passwordHash = hashPassword(password);
    const user = await db.users.create({
      email,
      passwordHash,
      name: typeof body.name === "string" ? body.name : null,
      picture: typeof body.picture === "string" ? body.picture : null,
      emailVerified: false,
    });
    const tokens = issueTokens({ user, amr: ["pwd"] });
    return json({ user: toPublicUser(user), tokens }, 201);
  } catch (err) {
    if (err instanceof EmailAlreadyExistsError) {
      return jsonError("email_taken", 409, "That email address is already registered.");
    }
    throw err;
  }
}
