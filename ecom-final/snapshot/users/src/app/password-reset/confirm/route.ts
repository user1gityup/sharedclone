import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/http";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/crypto";
import { checkPassword } from "@/lib/passwordPolicy";
import { consumePasswordResetToken } from "@/lib/passwordReset";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.json().catch(() => null);
  const token = body && typeof body === "object" && typeof body.token === "string" ? body.token : "";
  const newPassword =
    body && typeof body === "object" && typeof body.newPassword === "string" ? body.newPassword : "";
  if (!token) return authErrorResponse("reset_token_invalid");

  const userId = consumePasswordResetToken(token);
  if (!userId) return authErrorResponse("reset_token_invalid");

  const user = await db.users.findById(userId);
  if (!user) return authErrorResponse("reset_token_invalid");

  const policy = checkPassword(newPassword, { email: user.email });
  if (!policy.ok) return authErrorResponse("password_too_weak");

  await db.users.update(user.id, { passwordHash: hashPassword(newPassword) });
  return new NextResponse(null, { status: 204 });
}
