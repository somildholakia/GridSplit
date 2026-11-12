import { describe, expect, it, vi } from "vitest";
import handler from "./audio-proxy.js";

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(body) { this.body = body; return this; },
  };
}

describe("GridSplit Colab audio proxy", () => {
  it("adds Cloudflare's bypass header server-side for a health request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ ready: true }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);
    const req = {
      method: "GET",
      url: "/api/audio-proxy?endpoint=https%3A%2F%2Fdemo.trycloudflare.com&path=health",
      headers: { origin: "https://gridsplit-studio.vercel.app" },
    };
    const res = createResponse();
    try {
      await handler(req, res);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe("https://demo.trycloudflare.com/health");
      expect(fetchMock.mock.calls[0][1].headers["cf-skip-browser-warning"]).toBe("true");
      expect(res.statusCode).toBe(200);
      expect(String(res.body)).toContain('"ready":true');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("relays binary audio generation and forwards the request body", async () => {
    const wav = new Uint8Array([82, 73, 70, 70, 87, 65, 86, 69]);
    const fetchMock = vi.fn().mockResolvedValue(new Response(wav, {
      status: 200,
      headers: { "Content-Type": "audio/wav" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const req = {
      method: "POST",
      body: {
        endpoint: "https://demo.trycloudflare.com",
        path: "synthesize",
        payload: { text: "Hello", voice_id: "af_heart", language: "en-us", speed: 1 },
      },
      headers: { origin: "https://gridsplit-studio.vercel.app" },
    };
    const res = createResponse();
    try {
      await handler(req, res);
      expect(fetchMock.mock.calls[0][1].headers["Content-Type"]).toBe("application/json");
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(req.body.payload);
      expect(res.headers["content-type"]).toBe("audio/wav");
      expect(Buffer.from(res.body)).toEqual(Buffer.from(wav));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects untrusted origins and unsupported endpoints", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const badOrigin = createResponse();
      await handler({
        method: "GET",
        url: "/api/audio-proxy?endpoint=https%3A%2F%2Fdemo.trycloudflare.com&path=health",
        headers: { origin: "https://attacker.example" },
      }, badOrigin);
      expect(badOrigin.statusCode).toBe(403);

      const badEndpoint = createResponse();
      await handler({
        method: "GET",
        url: "/api/audio-proxy?endpoint=https%3A%2F%2Fexample.com&path=health",
        headers: { origin: "https://gridsplit-studio.vercel.app" },
      }, badEndpoint);
      expect(badEndpoint.statusCode).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
