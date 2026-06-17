import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const defaultFile = "examples/website/index.html";
const port = Number.parseInt(process.env.PORT ?? "4173", 10);

// HTTP Basic Auth, enabled only when PLAYGROUND_PASSWORD is set. User defaults to "admin".
const authUser = process.env.PLAYGROUND_USER ?? "admin";
const authPassword = process.env.PLAYGROUND_PASSWORD ?? "";
const authRealm = process.env.PLAYGROUND_REALM ?? "a11ydocs playground";

const safeEqual = (a, b) => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
};

const isAuthorized = (request) => {
  if (!authPassword) return true;
  const header = request.headers.authorization ?? "";
  if (!header.startsWith("Basic ")) return false;
  const [user, ...rest] = Buffer.from(header.slice(6), "base64").toString("utf8").split(":");
  return safeEqual(user, authUser) && safeEqual(rest.join(":"), authPassword);
};

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".pdf", "application/pdf"],
  [".svg", "image/svg+xml; charset=utf-8"]
]);

const server = http.createServer(async (request, response) => {
  if (!isAuthorized(request)) {
    response.writeHead(401, {
      "WWW-Authenticate": `Basic realm="${authRealm}", charset="UTF-8"`,
      "Content-Type": "text/plain; charset=utf-8"
    });
    response.end("Authentication required");
    return;
  }

  const requestPath = request.url === "/" ? defaultFile : decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname.slice(1));
  const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.resolve(rootDir, safePath);

  if (!filePath.startsWith(rootDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const details = await stat(filePath);
    if (details.isDirectory()) {
      response.writeHead(302, { Location: "/" });
      response.end();
      return;
    }

    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": contentTypes.get(path.extname(filePath)) ?? "application/octet-stream"
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(port, () => {
  console.log(`a11ydocs website example running at http://localhost:${port}/`);
});
