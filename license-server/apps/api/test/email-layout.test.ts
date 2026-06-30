import test from "node:test";
import assert from "node:assert/strict";

import { renderLayout } from "../src/domain/email/layout.js";

function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string): number => {
    const channels = hex
      .match(/[0-9a-f]{2}/gi)!
      .map((channel) => Number.parseInt(channel, 16) / 255)
      .map((channel) =>
        channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
      );
    return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
  };

  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

test("email layout exposes semantic structure to assistive technology", () => {
  const email = renderLayout("Account <ready>", "neutral", {
    heading: "Your account is ready",
    body: "Use the details below to sign in.",
    preheader: "Your private preview",
    facts: [
      { label: "Sign-in email", value: "person@example.com" },
      { label: "Temporary password", value: "not-a-real-password" },
    ],
    factsLabel: "Sign-in details",
    cta: { label: "Sign in", url: "https://example.com/login" },
  });

  assert.match(email.html, /<html lang="en" dir="ltr">/);
  assert.match(
    email.html,
    /<div role="article" aria-roledescription="email" aria-label="Account &lt;ready&gt;">/,
  );
  assert.match(email.html, /<div aria-hidden="true"[^>]*>Your private preview<\/div>/);
  assert.match(email.html, /<h1[^>]*>Your account is ready<\/h1>/);
  assert.match(email.html, /src="http:\/\/localhost:3000\/email-assets\/zeropdf-logo\.png"/);
  assert.match(email.html, /src="http:\/\/localhost:3000\/email-assets\/email\.png"/);
  assert.match(email.html, /alt="ZeroPDF"/);
  assert.match(email.html, /<table aria-label="Sign-in details"/);
  assert.match(email.html, /<th scope="row"[^>]*>Sign-in email<\/th>/);
  assert.match(email.html, /<td[^>]*>person@example\.com<\/td>/);
  assert.doesNotMatch(email.html, /<table role="presentation"[^>]*aria-label="Sign-in details"/);
  assert.match(email.html, /target="_blank" rel="noopener noreferrer"/);
});

test("small fine-print text meets WCAG AA contrast against the card", () => {
  const email = renderLayout("Contrast check", "neutral", {
    heading: "Readable fine print",
    body: "Body copy",
    note: "Important account note",
  });

  assert.match(email.html, /color:#777080;font-size:13px/);
  assert.match(email.html, /color:#777080;font-size:12px/);
  assert.ok(contrastRatio("#777080", "#ffffff") >= 4.5);
});
