import { NextResponse } from "next/server";
import { json, jsonError, authErrorResponse } from "@/lib/http";
import { db } from "@/lib/db";
import { issueTokens } from "@/lib/auth";
import { verifyTotp } from "@/lib/totp";
import { toPublicUser } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return jsonError("invalid_request", 400, "Request body must be JSON.");
  }
  const challengeToken = typeof body.challengeToken === "string" ? body.challengeToken : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!challengeToken) return authErrorResponse("totp_invalid");
  if (!code) return authErrorResponse("totp_invalid");

  const userId = db.totpChallenges.peek(challengeToken);
  if (!userId) return authErrorResponse("totp_invalid");

  const user = await db.users.findById(userId);
  if (!user || !user.totpSecret) return authErrorResponse("totp_invalid");

  let amr: string[];
  if (code.includes("-")) {
    if (!db.backupCodes.consume(user.id, code)) return authErrorResponse("backup_code_invalid");
    amr = ["pwd", "backup"];
  } else {
    if (!verifyTotp(user.totpSecret, code)) return authErrorResponse("totp_invalid");
    amr = ["pwd", "totp"];
  }

  db.totpChallenges.consume(challengeToken);
  const tokens = issueTokens({ user, amr });
  return json({ user: toPublicUser(user), tokens });
}
