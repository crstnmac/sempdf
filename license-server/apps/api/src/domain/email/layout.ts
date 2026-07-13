import { env } from "../../env.js";

/** Brand palette for inline email styles (clients ignore <style>/classes). */
const COLOR = {
  bg: "#ffffff",
  card: "#ffffff",
  border: "#e5e5e5",
  hairline: "#e5e5e5",
  ink: "#111111",
  body: "#333333",
  muted: "#686270",
  // 4.76:1 against the white card, preserving AA contrast for small text.
  faint: "#777080",
  primary: "#5928ED",
  primaryInk: "#ffffff",
} as const;

/** Eyebrow accent per tone. Buttons stay brand-primary for a consistent CTA. */
const EYEBROW = {
  neutral: COLOR.muted,
  info: "#5b4bd6",
  warning: "#9a6a00",
  danger: "#a11d33",
  success: "#1a7a4d",
} as const;

export type EmailTone = keyof typeof EYEBROW;

/** Escapes user-supplied text before interpolating into HTML. */
export function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface EmailBlock {
  /** Short eyebrow label above the heading (e.g. "Usage", "Trial"). */
  eyebrow?: string;
  heading: string;
  /** Lead paragraph(s). A string, or several rendered as separate paragraphs. */
  body: string | string[];
  /** Optional label→value rows rendered as a data table with row headers. */
  facts?: { label: string; value: string }[];
  /** Accessible name for the facts table. */
  factsLabel?: string;
  /** Single primary call-to-action. */
  cta?: { label: string; url: string };
  /** Optional fine-print note under the CTA (e.g. a security reminder). */
  note?: string;
  /** Inbox-preview text; falls back to the first body paragraph. */
  preheader?: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const logoUrl = () => `${env.appUrl}/email-assets/zeropdf-logo.png`;
const heroUrl = () => `${env.appUrl}/email-assets/email.png`;

/** Wraps structured content in the branded, responsive HTML email shell. */
export function renderLayout(subject: string, tone: EmailTone, block: EmailBlock): RenderedEmail {
  const bodyParas = Array.isArray(block.body) ? block.body : [block.body];
  const preheader = block.preheader ?? bodyParas[0] ?? "";

  const bodyHtml = bodyParas
    .map(
      (p, i) =>
        `<p style="margin:${i === 0 ? "0" : "14px 0 0"};color:${COLOR.body};font-size:16px;line-height:1.5;text-align:left;">${esc(p)}</p>`,
    )
    .join("");

  const factsHtml = block.facts?.length
    ? `<table aria-label="${esc(block.factsLabel ?? "Message details")}" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 4px;border:1px solid ${COLOR.border};border-radius:8px;border-collapse:separate;">
        <tbody>
        ${block.facts
          .map(
            (f, i) => `<tr>
              <th scope="row" style="padding:12px 14px;${i ? `border-top:1px solid ${COLOR.hairline};` : ""}color:${COLOR.muted};font-size:14px;font-weight:400;text-align:left;">${esc(f.label)}</th>
              <td style="padding:12px 14px;${i ? `border-top:1px solid ${COLOR.hairline};` : ""}color:${COLOR.ink};font-size:14px;font-weight:600;text-align:right;overflow-wrap:anywhere;">${esc(f.value)}</td>
            </tr>`,
          )
          .join("")}
        </tbody>
      </table>`
    : "";

  const ctaHtml = block.cta
    ? `<table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:26px auto 2px;">
        <tr><td style="border-radius:4px;background:${COLOR.primary};">
          <a href="${esc(block.cta.url)}" target="_blank" rel="noopener noreferrer"
             style="display:inline-block;padding:11px 22px;color:${COLOR.primaryInk};font-family:${FONT};font-size:15px;font-weight:500;line-height:1.2;text-decoration:none;border-radius:4px;">
            ${esc(block.cta.label)}
          </a>
        </td></tr>
      </table>`
    : "";

  const eyebrowHtml = block.eyebrow
    ? `<p style="margin:0 0 8px;color:${EYEBROW[tone]};font-size:12px;font-weight:700;letter-spacing:.08em;text-align:center;text-transform:uppercase;">${esc(block.eyebrow)}</p>`
    : "";

  const noteHtml = block.note
    ? `<p style="margin:18px 0 0;color:${COLOR.faint};font-size:13px;line-height:1.55;text-align:center;">${esc(block.note)}</p>`
    : "";

  const html = `<!doctype html>
<html lang="en" dir="ltr"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="light only"/>
<meta name="supported-color-schemes" content="light"/>
<title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${COLOR.bg};-webkit-font-smoothing:antialiased;">
  <div aria-hidden="true" style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(preheader)}</div>
  <div role="article" aria-roledescription="email" aria-label="${esc(subject)}">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR.bg};">
      <tr><td align="center" style="padding:24px 16px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${COLOR.card};border:1px solid ${COLOR.border};border-radius:8px;overflow:hidden;">
          <tr><td align="center" height="72" style="padding:0 24px;">
            <a href="${esc(env.appUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(env.productName)}">
              <img src="${esc(logoUrl())}" width="144" alt="${esc(env.productName)}"
                   style="display:block;width:144px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;"/>
            </a>
          </td></tr>
          <tr><td>
            <img src="${esc(heroUrl())}" width="600" alt=""
                 style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;"/>
          </td></tr>
          <tr><td style="padding:20px 24px 28px;font-family:${FONT};overflow-wrap:anywhere;">
            ${eyebrowHtml}
            <h1 style="margin:0 0 18px;color:${COLOR.ink};font-size:24px;line-height:1.35;font-weight:600;text-align:center;">${esc(block.heading)}</h1>
            ${bodyHtml}
            ${factsHtml}
            ${ctaHtml}
            ${noteHtml}
          </td></tr>
          <tr><td style="padding:18px 24px;border-top:1px solid ${COLOR.hairline};font-family:${FONT};overflow-wrap:anywhere;">
            <p style="margin:0;color:${COLOR.faint};font-size:12px;line-height:1.6;text-align:center;">
              This message was sent to you by ${esc(env.productName)}.
            </p>
          </td></tr>
        </table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
          <tr><td style="padding:28px 24px 0;font-family:${FONT};overflow-wrap:anywhere;">
            <p style="margin:0;color:${COLOR.faint};font-size:12px;line-height:1.6;text-align:center;">
              Need help? Email <a href="mailto:${esc(env.supportEmail)}" style="color:${COLOR.primary};font-weight:500;text-decoration:underline;">${esc(env.supportEmail)}</a>.
            </p>
            <p style="margin:8px 0 0;color:${COLOR.faint};font-size:12px;line-height:1.6;text-align:center;">
              © ${new Date().getFullYear()} <a href="${esc(env.appUrl)}" style="color:${COLOR.primary};font-weight:500;text-decoration:none;">${esc(env.productName)}</a>
              <span aria-hidden="true"> | </span> All Rights Reserved.
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </div>
</body></html>`;

  return { subject, html, text: toPlainText(bodyParas, block) };
}

/** Plain-text fallback so the email is readable without HTML rendering. */
function toPlainText(bodyParas: string[], block: EmailBlock): string {
  const lines: string[] = [env.productName, "", block.heading, "", ...bodyParas.flatMap((p) => [p, ""])];
  if (block.facts?.length) {
    for (const f of block.facts) lines.push(`${f.label}: ${f.value}`);
    lines.push("");
  }
  if (block.cta) lines.push(`${block.cta.label}: ${block.cta.url}`, "");
  if (block.note) lines.push(block.note, "");
  lines.push(`Need help? ${env.supportEmail}`);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
