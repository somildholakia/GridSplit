import { describe, expect, it, vi } from "vitest";
import { KokoroLocalProvider, normalizeLocalEndpoint, requestAudioApi } from "./kokoroProvider";

describe("Kokoro TTS endpoint allowlist", () => {
  it("accepts loopback endpoints and removes trailing paths", () => {
    expect(normalizeLocalEndpoint("http://127.0.0.1:8765/")).toBe("http://127.0.0.1:8765");
    expect(normalizeLocalEndpoint("http://localhost:8765/api/")).toBe("http://localhost:8765/api");
    expect(normalizeLocalEndpoint("https://[::1]:8765/")).toBe("https://[::1]:8765");
  });

  it("accepts an explicitly entered HTTPS Cloudflare Quick Tunnel", () => {
    expect(normalizeLocalEndpoint("https://dentists-holes-nikon-tourist.trycloudflare.com/"))
      .toBe("https://dentists-holes-nikon-tourist.trycloudflare.com");
    expect(normalizeLocalEndpoint("https://example.trycloudflare.com/tts/"))
      .toBe("https://example.trycloudflare.com/tts");
  });

  it("labels an explicit Quick Tunnel as a temporary GPU provider", () => {
    expect(new KokoroLocalProvider("https://demo.trycloudflare.com").label).toBe("Kokoro ONNX · temporary GPU");
    expect(new KokoroLocalProvider("http://127.0.0.1:8765").id).toBe("kokoro-local");
  });

  it("normalizes string voice IDs returned by the Colab Kokoro API", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ voices: ["af_heart", "bf_emma", "hm_psi"] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )));
    try {
      const voices = await new KokoroLocalProvider("https://demo.trycloudflare.com").listVoices();
      expect(voices).toEqual([
        { id: "af_heart", name: "Heart", language: "en-us", languageName: "American English" },
        { id: "bf_emma", name: "Emma", language: "en-gb", languageName: "British English" },
        { id: "hm_psi", name: "Psi", language: "hi", languageName: "Hindi" },
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses the same-origin proxy for Quick Tunnel health checks without browser custom headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ ready: true, engine: "Kokoro ONNX GPU" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await new KokoroLocalProvider("https://demo.trycloudflare.com").check();
      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/api/audio-proxy?");
      expect(url).toContain("endpoint=https%3A%2F%2Fdemo.trycloudflare.com");
      expect(url).toContain("path=health");
      expect(options.method).toBe("GET");
      expect(new Headers(options.headers).has("cf-skip-browser-warning")).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("sends Quick Tunnel synthesis through the same-origin POST proxy", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69]),
      { status: 200, headers: { "Content-Type": "audio/wav" } },
    ));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await requestAudioApi("https://demo.trycloudflare.com", "synthesize", {
        method: "POST",
        payload: { text: "Hello", voice_id: "af_heart", language: "en-us", speed: 1 },
      });
      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("/api/audio-proxy");
      expect(options.method).toBe("POST");
      expect(JSON.parse(String(options.body))).toEqual({
        endpoint: "https://demo.trycloudflare.com",
        path: "synthesize",
        payload: { text: "Hello", voice_id: "af_heart", language: "en-us", speed: 1 },
      });
      expect(new Headers(options.headers).get("Content-Type")).toBe("application/json");
      expect(new Headers(options.headers).has("cf-skip-browser-warning")).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps loopback requests direct", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ ready: true, engine: "Kokoro ONNX GPU" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await new KokoroLocalProvider("http://127.0.0.1:8765").check();
      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://127.0.0.1:8765/health");
      expect(new Headers(options.headers).has("cf-skip-browser-warning")).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects arbitrary remote hosts, LAN addresses, insecure tunnels, and credentials", () => {
    expect(() => normalizeLocalEndpoint("https://example.com")).toThrow(/loopback TTS services/);
    expect(() => normalizeLocalEndpoint("https://trycloudflare.com")).toThrow(/loopback TTS services/);
    expect(() => normalizeLocalEndpoint("https://example.trycloudflare.com.evil.test")).toThrow(/loopback TTS services/);
    expect(() => normalizeLocalEndpoint("http://example.trycloudflare.com")).toThrow(/loopback TTS services/);
    expect(() => normalizeLocalEndpoint("http://192.168.1.20:8765")).toThrow(/loopback TTS services/);
    expect(() => normalizeLocalEndpoint("http://user:pass@127.0.0.1:8765")).toThrow(/loopback TTS services/);
    expect(() => normalizeLocalEndpoint("file:///tmp/audio")).toThrow(/loopback TTS services/);
    expect(() => normalizeLocalEndpoint("not a URL")).toThrow(/loopback URL/);
  });
});
