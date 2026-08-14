import { redirect } from "@tanstack/react-router";
import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";
import { isMarkdownPreferred } from "fumadocs-core/negotiation";
import { encodeMarkdownUrl } from "@/lib/shared";

const basicAuthMiddleware = createMiddleware().server(({ next, request }) => {
  const password = process.env.DOCS_PASSWORD;
  if (!password) return next();

  const user = process.env.DOCS_USER ?? "admin";
  const authorization = request.headers.get("authorization");
  const expected = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;

  if (authorization !== expected) {
    return new Response("Authentication required", {
      status: 401,
      headers: { "WWW-Authenticate": `Basic realm="${process.env.DOCS_REALM ?? "zeropdf docs"}"` },
    });
  }

  return next();
});

const llmMiddleware = createMiddleware().server(({ next, request }) => {
  const url = new URL(request.url);
  if (!url.pathname.endsWith(".md") && isMarkdownPreferred(request)) {
    const slugs = url.pathname.split("/").filter(Boolean);
    url.pathname = encodeMarkdownUrl(slugs);
    throw redirect({ href: url.href, headers: { Vary: "Accept" } });
  }
  return next();
});

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware, basicAuthMiddleware, llmMiddleware],
}));
