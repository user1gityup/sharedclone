import { NextResponse } from "next/server";
import { json } from "@/lib/http";
import { verifyAccessToken } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const token = match ? match[1].trim() : null;

  if (!token) return json({ active: false });

  const claims = verifyAccessToken(token);
  if (!claims) return json({ active: false });

  return json({
    active: true,
    sub: claims.sub,
    aud: claims.aud,
    exp: claims.exp,
    iat: claims.iat,
    amr: claims.amr,
  });
}
