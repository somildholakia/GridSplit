import { afterEach, describe, expect, it, vi } from "vitest";
import { checkColabRenderer } from "./colabRenderer";
import { buildColabNotebook } from "../features/motion-studio/colabExport";

describe("Colab renderer connection", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rejects non-Cloudflare endpoints before making a request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(checkColabRenderer("https://example.com", "a".repeat(48))).rejects.toThrow(/trycloudflare/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects short tokens before making a request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(checkColabRenderer("https://abc.trycloudflare.com", "short")).rejects.toThrow(/token/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends the token in a header and not in the proxy URL", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      ready: true, gpuAvailable: true, gpuName: "Tesla T4",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const token = "test-token_" + "a".repeat(40);
    await expect(checkColabRenderer("https://abc.trycloudflare.com", token))
      .resolves.toContain("Tesla T4");
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).not.toContain(token);
    expect(new Headers(init?.headers).get("X-GridSplit-Token")).toBe(token);
  });

  it("reports CPU fallback when no NVIDIA GPU is visible", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      ready: true, gpuAvailable: false, gpuName: null,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await expect(checkColabRenderer("https://abc.trycloudflare.com", "b".repeat(48)))
      .resolves.toContain("CPU encoding");
  });

  it("generates a runnable notebook with authenticated loopback rendering and Quick Tunnel setup", async () => {
    const notebook = JSON.parse(await buildColabNotebook().text()) as {
      cells: Array<{ cell_type: string; source: string[] }>;
    };
    expect(notebook.cells).toHaveLength(3);
    const code = notebook.cells.filter((cell) => cell.cell_type === "code")
      .map((cell) => cell.source.join("")).join("\\n");
    expect(code).toContain("ffmpeg");
    expect(code).toContain("nvidia-smi");
    expect(code).toContain("secrets.token_urlsafe");
    expect(code).toContain("'127.0.0.1'");
    expect(code).toContain("cloudflared");
    expect(code).toContain("trycloudflare");
  });

  it("rejects a renderer that is reachable but missing FFmpeg readiness", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      ready: false,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await expect(checkColabRenderer("https://abc.trycloudflare.com", "c".repeat(48)))
      .rejects.toThrow(/FFmpeg\/ffprobe/i);
  });
});
