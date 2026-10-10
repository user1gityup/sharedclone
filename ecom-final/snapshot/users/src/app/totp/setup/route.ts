import { NextResponse } from "next/server";
import { json, jsonError } from "@/lib/http";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { generateTotpSecret, totpProvisioningUri, generateBackupCodes } from "@/lib/totp";
import { getTotpIssuer } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const claims = requireUser(request);
  if (!claims) return jsonError("unauthorized", 401, "A valid bearer token is required.");

  const user = await db.users.findById(claims.sub);
  if (!user) return jsonError("unauthorized", 401, "A valid bearer token is required.");

  const secret = generateTotpSecret();
  const recoveryCodes = generateBackupCodes(10);

  await db.users.update(user.id, { totpSecret: secret });
  db.backupCodes.set(user.id, recoveryCodes);

  return json({
    secret,
    otpauthUrl: totpProvisioningUri(secret, user.email, getTotpIssuer()),
    recoveryCodes,
  });
}
