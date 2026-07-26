import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./dist/", import.meta.url));
const upstream = "https://pease-production.up.railway.app";
const port = Number(process.env.PORT || 3000);
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};
const hopByHop = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function staticPath(pathname) {
  const decoded = decodeURIComponent(pathname);
  const candidate = normalize(join(root, decoded.replace(/^\/+/u, "")));
  return candidate.startsWith(root) && existsSync(candidate) && statSync(candidate).isFile()
    ? candidate
    : join(root, "index.html");
}

async function proxy(request, response) {
  const target = new URL(request.url, upstream);
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (!hopByHop.has(name) && value !== undefined)
      headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  headers.set("host", target.host);
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const upstreamResponse = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? request : undefined,
    duplex: hasBody ? "half" : undefined,
    redirect: "manual",
  });
  const responseHeaders = {};
  upstreamResponse.headers.forEach((value, name) => {
    if (!hopByHop.has(name) && name !== "set-cookie") responseHeaders[name] = value;
  });
  const cookies = upstreamResponse.headers.getSetCookie();
  if (cookies.length) responseHeaders["set-cookie"] = cookies;
  response.writeHead(upstreamResponse.status, responseHeaders);
  if (!upstreamResponse.body) return response.end();
  for await (const chunk of upstreamResponse.body) response.write(chunk);
  response.end();
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      await proxy(request, response);
      return;
    }
    const file = staticPath(url.pathname);
    const revalidate =
      file.endsWith("index.html") ||
      file.endsWith("sw.js") ||
      file.endsWith("manifest.webmanifest");
    response.writeHead(200, {
      "content-type": contentTypes[extname(file)] ?? "application/octet-stream",
      "cache-control": revalidate
        ? "no-cache"
        : "public, max-age=31536000, immutable",
    });
    createReadStream(file).pipe(response);
  } catch {
    if (!response.headersSent)
      response.writeHead(502, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ code: "PROXY_ERROR", message: "Service temporairement indisponible." }));
  }
}).listen(port, "0.0.0.0");
