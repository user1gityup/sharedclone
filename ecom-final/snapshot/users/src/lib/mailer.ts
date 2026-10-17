/**
 * Outbound mail. A no-op in development; wire SMTP_URL in production.
 */
export interface MailInput {
  to: string;
  subject: string;
  text: string;
}

export async function sendMail(_input: MailInput): Promise<void> {
  // No-op in development. A production transport (SMTP_URL / MAIL_FROM) can
  // replace this body while keeping the same call signature.
}
