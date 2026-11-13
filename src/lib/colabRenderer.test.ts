import { afterEach, describe, expect, it, vi } from "vitest";
import { checkColabRenderer, renderDriveSourceOnColab } from "./colabRenderer";
import { buildColabNotebook, buildDriveSyncNotebook } from "../features/motion-studio/colabExport";

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


describe("Drive Smart Sync Colab workflow", () => {
  afterEach(() => vi.restoreAllMocks());

  const request = {
    folderPath: "/content/drive/MyDrive/youtube video mars 1",
    archiveName: "mars E1 zip.zip",
    audioName: "Mars-E1-complete-audio.wav",
    manifest: {
      format: "gridsplit-motion-sync" as const,
      version: 1 as const,
      audio: { fileName: "Mars-E1-complete-audio.wav", durationSeconds: 12 },
      images: [
        { fileName: "frame-001.png", startSeconds: 0, endSeconds: 6 },
        { fileName: "frame-002.png", startSeconds: 6, endSeconds: 12 },
      ],
    },
  };

  it("sends only Drive paths and the small sync manifest to the live Colab renderer", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "a".repeat(32), status: "completed", progress: 100,
        output: { bytes: 3 },
      }), { status: 202, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 206 }));
    const progress: Array<{ stage: string; progress: number }> = [];
    const result = await renderDriveSourceOnColab(
      "https://abc.trycloudflare.com", request,
      (value) => progress.push(value),
    );
    expect(result.blob.size).toBe(3);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("https://abc.trycloudflare.com/v1/drive/render");
    const payload = JSON.parse(String(init?.body));
    expect(payload.folderPath).toBe(request.folderPath);
    expect(payload.archiveName).toBe(request.archiveName);
    expect(payload.audioName).toBe(request.audioName);
    expect(payload.syncManifest.images).toHaveLength(2);
    expect(payload).not.toHaveProperty("mediaArchive");
    expect(progress.some((item) => item.stage === "downloading" && item.progress === 100)).toBe(true);
  });

  it("rejects non-Quick-Tunnel endpoints before sending Drive paths", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(renderDriveSourceOnColab("https://example.com", request, () => undefined))
      .rejects.toThrow(/trycloudflare/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("generates a notebook that mounts Drive, analyzes media and starts the live tunnel", async () => {
    const notebook = JSON.parse(await buildDriveSyncNotebook().text()) as {
      cells: Array<{ cell_type: string; source: string[] }>;
    };
    const code = notebook.cells.filter((cell) => cell.cell_type === "code")
      .map((cell) => cell.source.join("")).join("\n");
    expect(code).toContain("drive.mount('/content/drive')");
    expect(code).toContain("faster-whisper");
    expect(code).toContain("GridSplit Drive renderer");
    expect(code).toContain("RENDERER_SOURCE_B64");
    expect(code).toContain("GATEWAY_SOURCE_B64");
    expect(code).toContain("cloudflared");
    expect(code).toContain("mars E1 zip.zip");
    expect(code).toContain("Mars-E1-complete-audio.wav");
  });
});
