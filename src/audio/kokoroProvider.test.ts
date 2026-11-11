import { describe, expect, it, vi } from "vitest";
import { KokoroLocalProvider, normalizeLocalEndpoint } from "./kokoroProvider";

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
