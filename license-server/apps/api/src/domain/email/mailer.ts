import nodemailer, { type Transporter } from "nodemailer";

import { env, isSmtpConfigured } from "../../env.js";
import type { RenderedEmail } from "./layout.js";

let transporter: Transporter | null = null;

/** Lazily builds the SMTP transport from env (reused across sends). */
function getTransport(): Transporter | null {
  if (!isSmtpConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.secure,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
    });
  }
  return transporter;
}

export interface SendResult {
  ok: boolean;
  /** "skipped" when SMTP is unconfigured (dev/no-op), else "sent" or "error". */
  status: "sent" | "skipped" | "error";
  error?: string;
}

/**
 * Sends one rendered email. When SMTP is not configured the message is logged
 * instead of sent, so local/dev environments work without a mail server.
 */
export async function sendEmail(to: string, email: RenderedEmail): Promise<SendResult> {
  const transport = getTransport();
  if (!transport) {
    console.info(`[email:skipped] to=${to} subject="${email.subject}" (SMTP not configured)`);
    return { ok: true, status: "skipped" };
  }
  try {
    await transport.sendMail({
      from: env.smtp.fromName ? `"${env.smtp.fromName}" <${env.smtp.from}>` : env.smtp.from,
      to,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
    return { ok: true, status: "sent" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[email:error] to=${to} subject="${email.subject}": ${message}`);
    return { ok: false, status: "error", error: message };
  }
}

/** Verifies the SMTP connection/credentials. Used by a health/diagnostic route. */
export async function verifyTransport(): Promise<{ configured: boolean; ok: boolean; error?: string }> {
  const transport = getTransport();
  if (!transport) return { configured: false, ok: false };
  try {
    await transport.verify();
    return { configured: true, ok: true };
  } catch (err) {
    return { configured: true, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
