import { NextResponse } from "next/server";
import { createRemoteVerifier, TokenVerificationError } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  if (!token) {
    return NextResponse.json(
      { error: "missing_token", error_description: "Bearer token required" },
      { status: 401 },
    );
  }

  const verifier = createRemoteVerifier({
    jwksUrl: process.env.USERS_JWKS_URL ?? "http://localhost:3000/.well-known/jwks.json",
    issuer: process.env.USERS_ISSUER ?? "",
    audience: process.env.USERS_AUDIENCE ?? "canna",
  });

  try {
    const claims = await verifier(token);
    return NextResponse.json({
      sub: claims.sub,
      email: claims.email,
      amr: claims.amr,
      aud: claims.aud,
    });
  } catch (err) {
    if (err instanceof TokenVerificationError) {
      return NextResponse.json({ error: err.code, error_description: err.message }, { status: 401 });
    }
    return NextResponse.json(
      { error: "invalid_signature", error_description: err instanceof Error ? err.message : "verification failed" },
      { status: 401 },
    );
  }
}
