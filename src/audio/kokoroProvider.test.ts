import { describe, expect, it } from "vitest";
import { normalizeLocalEndpoint } from "./kokoroProvider";

describe("local TTS endpoint privacy guard", () => {
  it("accepts loopback endpoints and removes trailing paths", () => {
    expect(normalizeLocalEndpoint("http://127.0.0.1:8765/")).toBe("http://127.0.0.1:8765");
    expect(normalizeLocalEndpoint("http://localhost:8765/api/")).toBe("http://localhost:8765/api");
    expect(normalizeLocalEndpoint("https://[::1]:8765/")).toBe("https://[::1]:8765");
  });

  it("rejects network hosts, LAN addresses, credentials, and non-HTTP schemes", () => {
    expect(() => normalizeLocalEndpoint("https://example.com")).toThrow(/local TTS service/);
    expect(() => normalizeLocalEndpoint("http://192.168.1.20:8765")).toThrow(/local TTS service/);
    expect(() => normalizeLocalEndpoint("http://user:pass@127.0.0.1:8765")).toThrow(/local TTS service/);
    expect(() => normalizeLocalEndpoint("file:///tmp/audio")).toThrow(/local TTS service/);
    expect(() => normalizeLocalEndpoint("not a URL")).toThrow(/valid local engine address/);
  });
});
