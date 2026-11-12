const GET_PATHS = new Set(["health", "voices", "capabilities"]);
const POST_PATHS = new Set(["synthesize", "generate-music", "generate-sfx"]);
const TUNNEL_SUFFIX = ".trycloudflare.com";

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
    return url.protocol === "https:"
      && url.hostname.endsWith(".vercel.app")
      && url.hostname.startsWith("gridsplit-studio");
  } catch {
    return false;
  }
}

function validateEndpoint(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new Error("Enter the current HTTPS Cloudflare Quick Tunnel URL.");
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:"
    || !host.endsWith(TUNNEL_SUFFIX)
    || host.length <= TUNNEL_SUFFIX.length
    || url.username
    || url.password
    || (url.pathname !== "" && url.pathname !== "/")
    || url.search
    || url.hash
  ) {
    throw new Error("The audio proxy only accepts a root HTTPS *.trycloudflare.com endpoint.");
  }
  return url.origin;
}

function readGetInput(req) {
  const url = new URL(req.url || "/", "https://gridsplit-studio.vercel.app");
  return {
    endpoint: url.searchParams.get("endpoint"),
    path: url.searchParams.get("path"),
    payload: undefined,
  };
}

function readPostInput(req) {
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Expected a JSON request containing endpoint, path, and payload.");
  }
  return {
    endpoint: body.endpoint,
    path: body.path,
    payload: body.payload,
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const method = String(req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return sendJson(res, 405, { detail: "Method not allowed." });
  }

  const origin = req.headers?.origin;
  if (!isAllowedOrigin(origin)) {
    return sendJson(res, 403, { detail: "This audio proxy only accepts requests from GridSplit Studio." });
  }

  let input;
  let endpoint;
  try {
    input = method === "GET" ? readGetInput(req) : readPostInput(req);
    endpoint = validateEndpoint(input.endpoint);
  } catch (error) {
    return sendJson(res, 400, { detail: error instanceof Error ? error.message : "Invalid proxy request." });
  }

  const path = String(input.path || "").replace(/^\/+/, "");
  const allowed = method === "GET" ? GET_PATHS : POST_PATHS;
  if (!allowed.has(path) || path.includes("/") || path.includes("..")) {
    return sendJson(res, 400, { detail: "Unsupported audio API path." });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 295_000);
  try {
    const headers = {
      Accept: "application/json, audio/wav",
      // This header is added server-side, so it does not trigger browser CORS preflight.
      "cf-skip-browser-warning": "true",
    };
    const options = { method, headers, signal: controller.signal };
    if (method === "POST") {
      headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(input.payload ?? {});
    }

    const upstream = await fetch(endpoint + "/" + path, options);
    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    if (contentType.toLowerCase().includes("text/html")) {
      return sendJson(res, 502, {
        detail: "Cloudflare returned its browser-warning page instead of the audio API. Confirm the Colab Quick Tunnel is still running and copy its latest URL.",
      });
    }

    const body = Buffer.from(await upstream.arrayBuffer());
    res.statusCode = upstream.status;
    res.setHeader("Content-Type", contentType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Length", String(body.byteLength));
    return res.end(body);
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return sendJson(res, timedOut ? 504 : 502, {
      detail: timedOut
        ? "The Colab audio request exceeded the proxy time limit. Try a shorter segment or restart the Colab generation cell."
        : "GridSplit could not reach the Colab Quick Tunnel. The tunnel may have expired or the Colab runtime may have stopped.",
    });
  } finally {
    clearTimeout(timeout);
  }
}
