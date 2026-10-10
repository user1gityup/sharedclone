import { NextResponse } from "next/server";
import { json } from "@/lib/http";
import { db } from "@/lib/db";
import { sendMail } from "@/lib/mailer";
import { getAppBaseUrl } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.json().catch(() => null);
  const email = body && typeof body === "object" && typeof body.email === "string" ? body.email : "";

  // Always 202 to avoid account enumeration.
  if (email) {
    const user = await db.users.findByEmail(email);
    if (user && !user.emailVerified) {
      const token = db.emailVerifications.issue(user.id, 60 * 60 * 24);
      const link = `${getAppBaseUrl()}/email-verification/confirm?token=${encodeURIComponent(token)}`;
      await sendMail({
        to: user.email,
        subject: "Verify your email address",
        text: `Confirm your email by opening: ${link}`,
      });
    }
  }
  return json({}, 202);
}
