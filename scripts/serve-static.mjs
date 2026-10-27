// Minimal, dependency-free static server for the built Aani Social SPA.
// - serves files from the given directory (default ./public)
// - falls back to index.html for client-side routes (/post/:id, /saved, ...)
// - gzip compresses text assets on the fly
// - binds 0.0.0.0 and honours PORT (required by the hosting platform)
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { createGzip } from "node:zlib";

const rootArg = process.argv[2] || process.env.STATIC_DIR || "./public";
const root = path.resolve(process.cwd(), rootArg);
const port = Number(process.env.PORT || 80);
const host = "0.0.0.0";
const indexFile = path.join(root, "index.html");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

const COMPRESSIBLE = new Set([
  ".html",
  ".js",
  ".mjs",
  ".css",
  ".json",
  ".map",
  ".svg",
  ".txt",
  ".webmanifest",
]);

function setHeaders(res, ext, isHtml) {
  res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (isHtml) {
    res.setHeader("Cache-Control", "no-cache");
  } else if (ext === ".html") {
    res.setHeader("Cache-Control", "public, max-age=300");
  } else {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  }
}

async function isFile(filePath) {
  try {
    const info = await stat(filePath);
    return info.isFile();
  } catch {
    return false;
  }
}

async function resolveFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  const normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const candidate = path.join(root, normalized);
  // Prevent path traversal outside of the served directory.
  if (candidate !== root && !candidate.startsWith(root + path.sep)) return null;
  if (await isFile(candidate)) return candidate;
  return null;
}

async function send(res, filePath, method, req, status = 200) {
  const ext = path.extname(filePath).toLowerCase();
  const isHtml = filePath === indexFile;
  res.statusCode = status;
  setHeaders(res, ext, isHtml);

  const acceptsGzip = String(req.headers["accept-encoding"] || "").includes("gzip");
  if (acceptsGzip && COMPRESSIBLE.has(ext)) {
    res.setHeader("Content-Encoding", "gzip");
    res.setHeader("Vary", "Accept-Encoding");
    if (method === "HEAD") return res.end();
    createReadStream(filePath).pipe(createGzip()).pipe(res);
    return;
  }

  if (method === "HEAD") return res.end();
  createReadStream(filePath).pipe(res);
}

const server = createServer(async (req, res) => {
  const method = req.method || "GET";
  if (method !== "GET" && method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, HEAD");
    res.end("Method Not Allowed");
    return;
  }

  const urlPath = req.url || "/";

  if (urlPath === "/healthz" || urlPath === "/health") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  try {
    const file = await resolveFile(urlPath);
    if (file) {
      await send(res, file, method, req);
      return;
    }
    // SPA fallback so deep links and refreshes on client routes keep working.
    if (await isFile(indexFile)) {
      await send(res, indexFile, method, req, 200);
      return;
    }
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Not Found");
  } catch (error) {
    console.error("static server error", error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
    }
    res.end("Internal Server Error");
  }
});

server.listen(port, host, () => {
  console.log(`static server listening on http://${host}:${port} (root: ${root})`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
