const UUID = /^[a-f0-9]{32}$/;
const TOKEN = /^[A-Za-z0-9_-]{32,128}$/;
const MAX_CHUNK = 3 * 1024 * 1024;
const GET_PATH = /^\/v1\/(?:health|jobs\/[a-f0-9]{32}|jobs\/[a-f0-9]{32}\/output)$/;
const POST_PATH = /^\/v1\/uploads$|^\/v1\/uploads\/[a-f0-9]{32}\/complete$/;
const PUT_PATH = /^\/v1\/uploads\/[a-f0-9]{32}\/[0-9]{1,3}$/;
const DELETE_PATH = /^\/v1\/(?:jobs|uploads)\/[a-f0-9]{32}$/;

export const config = {
  api: { bodyParser: false },
  maxDuration: 300,
};

function queryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function sendJson(res, status, value) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(value));
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    return (url.protocol === "https:" && (
      host === "gridsplit-studio.vercel.app" ||
      host === "gridsplit-kappa.vercel.app" ||
      /^gridsplit-[a-z0-9-]+\\.vercel\\.app$/.test(host)
    )) || (url.protocol === "http:" && (
      host === "localhost" || host === "127.0.0.1"
    ) && url.port === "5173");
  } catch {
    return false;
  }
}

function validateEndpoint(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new Error("Enter the current HTTPS Cloudflare Quick Tunnel URL from the Colab notebook.");
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    !host.endsWith(".trycloudflare.com") ||
    host.length <= ".trycloudflare.com".length ||
    url.username || url.password || url.pathname !== "/" || url.search || url.hash
  ) {
    throw new Error("The Colab renderer accepts only a root HTTPS *.trycloudflare.com URL.");
  }
  return url.origin;
}

async function readBody(req, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new Error("Request body exceeds the allowed chunk size.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, size);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const method = String(req.method || "GET").toUpperCase();
  if (!["GET", "POST", "PUT", "DELETE"].includes(method)) {
    res.setHeader("Allow", "GET, POST, PUT, DELETE");
    return sendJson(res, 405, { error: "Method not allowed." });
  }
  if (!isAllowedOrigin(req.headers && req.headers.origin)) {
    return sendJson(res, 403, { error: "This render proxy only accepts requests from GridSplit." });
  }

  let endpoint;
  let path = String(queryValue(req.query && req.query.path) || "");
  const tokenHeader = req.headers && req.headers["x-gridsplit-token"];
  const token = String(Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader || "");
  try {
    endpoint = validateEndpoint(queryValue(req.query && req.query.endpoint));
    if (method === "POST") {
      const body = await readBody(req, 64 * 1024);
      const input = JSON.parse(body.toString("utf8"));
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new Error("Invalid render proxy JSON payload.");
      }
      req.renderPayload = input.payload ?? {};
    } else if (method === "PUT") {
      req.renderBody = await readBody(req, MAX_CHUNK);
    }
  } catch (error) {
    return sendJson(res, 400, { error: error instanceof Error ? error.message : "Invalid render proxy request." });
  }

  if (!TOKEN.test(token)) {
    return sendJson(res, 400, { error: "Enter the 32-character connection token printed by the Colab notebook." });
  }

  const validPath = method === "GET" ? GET_PATH.test(path)
    : method === "POST" ? POST_PATH.test(path)
    : method === "PUT" ? PUT_PATH.test(path)
    : DELETE_PATH.test(path);
  if (!validPath) return sendJson(res, 400, { error: "Unsupported Colab render API route." });

  const headers = {
    "X-GridSplit-Token": token,
    "cf-skip-browser-warning": "true",
    "Accept": "application/json, video/mp4",
  };
  const options = { method, headers };
  if (method === "POST") {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(req.renderPayload);
  } else if (method === "PUT") {
    headers["Content-Type"] = "application/octet-stream";
    options.body = req.renderBody;
  } else if (method === "GET" && path.endsWith("/output")) {
    const offset = Number(queryValue(req.query && req.query.offset) || 0);
    const length = Number(queryValue(req.query && req.query.length) || MAX_CHUNK);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || length > MAX_CHUNK) {
      return sendJson(res, 400, { error: "Invalid rendered video byte range." });
    }
    headers.Range = "bytes=" + offset + "-" + (offset + length - 1);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), method === "POST" ? 120_000 : 60_000);
  try {
    const upstream = await fetch(endpoint + path, { ...options, signal: controller.signal, redirect: "manual" });
    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    const body = Buffer.from(await upstream.arrayBuffer());
    res.statusCode = upstream.status;
    res.setHeader("Content-Type", contentType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    if (upstream.headers.get("content-range")) res.setHeader("Content-Range", upstream.headers.get("content-range"));
    if (upstream.headers.get("accept-ranges")) res.setHeader("Accept-Ranges", upstream.headers.get("accept-ranges"));
    res.setHeader("Content-Length", String(body.byteLength));
    return res.end(body);
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return sendJson(res, timedOut ? 504 : 502, {
      error: timedOut
        ? "The Colab renderer did not respond in time. Check that its runtime and Quick Tunnel are still running."
        : "GridSplit could not reach the Colab Quick Tunnel. It may have expired or the Colab runtime may have stopped.",
    });
  } finally {
    clearTimeout(timeout);
  }
}
