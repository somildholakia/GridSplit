import { afterEach, describe, expect, it, vi } from "vitest";
import { checkColabRenderer } from "./colabRenderer";
import { buildColabNotebook } from "../features/motion-studio/colabExport";

describe("Colab renderer connection", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rejects non-Cloudflare endpoints before making a request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(checkColabRenderer("https://example.com")).rejects.toThrow(/trycloudflare/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });


  it("connects directly to Colab without a token", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      ready: true, gpuAvailable: true, gpuName: "Tesla T4",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await expect(checkColabRenderer("https://abc.trycloudflare.com")).resolves.toContain("Tesla T4");
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("https://abc.trycloudflare.com/v1/health");
    expect(new Headers(init?.headers).has("X-GridSplit-Token")).toBe(false);
  });

  it("reports CPU fallback when no NVIDIA GPU is visible", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      ready: true, gpuAvailable: false, gpuName: null,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await expect(checkColabRenderer("https://abc.trycloudflare.com"))
      .resolves.toContain("CPU encoding");
  });

  it("generates a runnable notebook with direct loopback rendering and Quick Tunnel setup", async () => {
    const notebook = JSON.parse(await buildColabNotebook().text()) as {
      cells: Array<{ cell_type: string; source: string[] }>;
    };
    expect(notebook.cells).toHaveLength(3);
    const code = notebook.cells.filter((cell) => cell.cell_type === "code")
      .map((cell) => cell.source.join("")).join("\\n");
    expect(code).toContain("ffmpeg");
    expect(code).toContain("nvidia-smi");
    expect(code).not.toContain("secrets.token_urlsafe");
    expect(code).not.toContain("X-GridSplit-Token");
    expect(code).toContain("'127.0.0.1'");
    expect(code).toContain("cloudflared");
    expect(code).toContain("trycloudflare");
  });

  it("rejects a renderer that is reachable but missing FFmpeg readiness", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      ready: false,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await expect(checkColabRenderer("https://abc.trycloudflare.com"))
      .rejects.toThrow(/FFmpeg\/ffprobe/i);
  });
});
