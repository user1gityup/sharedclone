import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/http";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.json().catch(() => null);
  const token = body && typeof body === "object" && typeof body.token === "string" ? body.token : "";
  if (!token) return authErrorResponse("verification_token_invalid");

  const userId = db.emailVerifications.consume(token);
  if (!userId) return authErrorResponse("verification_token_invalid");

  const user = await db.users.findById(userId);
  if (user) await db.users.update(user.id, { emailVerified: true });

  return new NextResponse(null, { status: 204 });
}
