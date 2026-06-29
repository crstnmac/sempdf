import { env } from "../../env.js";

/** Brand palette for inline email styles (clients ignore <style>/classes). */
const COLOR = {
  bg: "#f5f4f8",
  card: "#ffffff",
  border: "#e6e2ee",
  hairline: "#efedf4",
  ink: "#1d1a27",
  body: "#3f3b4a",
  muted: "#6b6577",
  faint: "#9b95a6",
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
  /** Optional label→value rows rendered as a definition list. */
  facts?: { label: string; value: string }[];
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

/** Wraps structured content in the branded, responsive HTML email shell. */
export function renderLayout(subject: string, tone: EmailTone, block: EmailBlock): RenderedEmail {
  const bodyParas = Array.isArray(block.body) ? block.body : [block.body];
  const preheader = block.preheader ?? bodyParas[0] ?? "";

  const bodyHtml = bodyParas
    .map(
      (p, i) =>
        `<p style="margin:${i === 0 ? "0" : "14px 0 0"};color:${COLOR.body};font-size:15px;line-height:1.62;">${esc(p)}</p>`,
    )
    .join("");

  const factsHtml = block.facts?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 4px;border:1px solid ${COLOR.border};border-radius:10px;border-collapse:separate;">
        ${block.facts
          .map(
            (f, i) => `<tr>
              <td style="padding:11px 14px;${i ? `border-top:1px solid ${COLOR.hairline};` : ""}color:${COLOR.muted};font-size:13px;">${esc(f.label)}</td>
              <td style="padding:11px 14px;${i ? `border-top:1px solid ${COLOR.hairline};` : ""}color:${COLOR.ink};font-size:13px;font-weight:600;text-align:right;">${esc(f.value)}</td>
            </tr>`,
          )
          .join("")}
      </table>`
    : "";

  const ctaHtml = block.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 2px;">
        <tr><td style="border-radius:8px;background:${COLOR.primary};">
          <a href="${esc(block.cta.url)}" target="_blank"
             style="display:inline-block;padding:12px 22px;color:${COLOR.primaryInk};font-family:${FONT};font-size:14px;font-weight:600;line-height:1;text-decoration:none;border-radius:8px;">
            ${esc(block.cta.label)}
          </a>
        </td></tr>
      </table>`
    : "";

  const eyebrowHtml = block.eyebrow
    ? `<p style="margin:0 0 8px;color:${EYEBROW[tone]};font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">${esc(block.eyebrow)}</p>`
    : "";

  const noteHtml = block.note
    ? `<p style="margin:18px 0 0;color:${COLOR.faint};font-size:13px;line-height:1.55;">${esc(block.note)}</p>`
    : "";

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="light only"/>
<meta name="supported-color-schemes" content="light"/>
<title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${COLOR.bg};-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR.bg};">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${COLOR.card};border:1px solid ${COLOR.border};border-radius:12px;">
        <tr><td style="padding:26px 32px 0;font-family:${FONT};">
          <span style="font-size:16px;font-weight:700;color:${COLOR.ink};letter-spacing:-.01em;">${esc(env.productName)}</span>
        </td></tr>
        <tr><td style="padding:24px 32px 30px;font-family:${FONT};">
          ${eyebrowHtml}
          <h1 style="margin:0 0 14px;color:${COLOR.ink};font-size:20px;line-height:1.35;font-weight:600;">${esc(block.heading)}</h1>
          ${bodyHtml}
          ${factsHtml}
          ${ctaHtml}
          ${noteHtml}
        </td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid ${COLOR.hairline};font-family:${FONT};">
          <p style="margin:0;color:${COLOR.faint};font-size:12px;line-height:1.6;">
            ${esc(env.productName)} sends this message to the contact on file for your account.
            Need help? Email <a href="mailto:${esc(env.supportEmail)}" style="color:${COLOR.muted};text-decoration:underline;">${esc(env.supportEmail)}</a>.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
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
