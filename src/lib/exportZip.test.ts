import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createImageZip, type ExportCell, YOUTUBE_FRAME_HEIGHT, YOUTUBE_FRAME_WIDTH } from "./exportZip";

function makeCells(count: number): ExportCell[] {
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / 14);
    const column = index % 14;
    return {
      row,
      column,
      x: column * 100,
      y: row * 80,
      width: 100,
      height: 80,
    };
  });
}

function installCanvasMock() {
  const drawImage = vi.fn();
  const fillRect = vi.fn();
  const save = vi.fn();
  const restore = vi.fn();
  const context = { drawImage, fillRect, save, restore, filter: "none", fillStyle: "", imageSmoothingEnabled: false, imageSmoothingQuality: "low" };
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    toBlob: vi.fn((callback: BlobCallback) => {
      callback(new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }));
    }),
  };
  vi.stubGlobal("document", {
    createElement: vi.fn(() => canvas),
  });
  return { drawImage, fillRect, canvas, context };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("contact-sheet image ZIP export", () => {
  it("writes exactly 196 uniquely numbered 1920x1080 YouTube PNG frames and a manifest", async () => {
    const { drawImage, fillRect, canvas, context } = installCanvasMock();
    const count = 196;

    const blob = await createImageZip({
      image: {} as HTMLImageElement,
      cells: makeCells(count),
      gutter: 2,
      prefix: "frame-",
      startNumber: 1,
      digits: 3,
      originalName: "196-frame-contact-sheet.png",
    });

    const archive = await JSZip.loadAsync(await blob.arrayBuffer());
    const imagePaths = Object.keys(archive.files)
      .filter((path) => path.startsWith("gridsplit-images/frame-") && path.endsWith(".png"))
      .sort();
    const manifest = await archive.file("manifest.csv")?.async("string");

    expect(imagePaths).toHaveLength(count);
    expect(new Set(imagePaths).size).toBe(count);
    expect(imagePaths[0]).toBe("gridsplit-images/frame-001.png");
    expect(imagePaths.at(-1)).toBe("gridsplit-images/frame-196.png");
    expect(manifest?.trim().split("\n")).toHaveLength(count + 1);
    expect(manifest).toContain('"frame-001.png",1,1,2,2,96,76,1920,1080');
    expect(manifest).toContain('"frame-196.png",14,14,1302,1042,96,76,1920,1080');
    expect(drawImage).toHaveBeenCalledTimes(count);
    expect(fillRect).toHaveBeenCalledTimes(count);
    expect(canvas.toBlob).toHaveBeenCalledTimes(count);
    expect(canvas.width).toBe(YOUTUBE_FRAME_WIDTH);
    expect(canvas.height).toBe(YOUTUBE_FRAME_HEIGHT);
    expect(context.imageSmoothingEnabled).toBe(true);
    expect(context.imageSmoothingQuality).toBe("high");
  });

  it("fits a wide crop without changing its aspect ratio", async () => {
    const { drawImage } = installCanvasMock();
    await createImageZip({
      image: {} as HTMLImageElement,
      cells: [{ row: 0, column: 0, x: 0, y: 0, width: 200, height: 50 }],
      gutter: 0,
      prefix: "wide-",
      startNumber: 1,
      digits: 2,
      originalName: "contact.png",
    });
    expect(drawImage).toHaveBeenCalledWith({}, 0, 0, 200, 50, 0, 300, 1920, 480);
  });

  it("fills the widescreen frame in cover mode and crops only the overflow", async () => {
    const { drawImage } = installCanvasMock();
    await createImageZip({
      image: {} as HTMLImageElement,
      cells: [{ row: 0, column: 0, x: 0, y: 0, width: 200, height: 50 }],
      gutter: 0,
      prefix: "cover-",
      startNumber: 1,
      digits: 2,
      originalName: "contact.png",
      fitMode: "cover",
    });
    expect(drawImage).toHaveBeenCalledWith({}, 0, 0, 200, 50, -1200, 0, 4320, 1080);
  });

  it("uses a blurred full-bleed background while keeping the original crop sharp in blur mode", async () => {
    const { drawImage, context, fillRect } = installCanvasMock();
    const blob = await createImageZip({
      image: {} as HTMLImageElement,
      cells: [{ row: 0, column: 0, x: 0, y: 0, width: 200, height: 50 }],
      gutter: 0,
      prefix: "blur-",
      startNumber: 1,
      digits: 2,
      originalName: "contact.png",
      fitMode: "blur",
      backgroundColor: "#202020",
    });
    const archive = await JSZip.loadAsync(await blob.arrayBuffer());
    const readme = await archive.file("README.txt")?.async("string");
    expect(drawImage).toHaveBeenCalledTimes(2);
    expect(context.save).toHaveBeenCalledTimes(1);
    expect(context.restore).toHaveBeenCalledTimes(1);
    expect(fillRect).toHaveBeenCalledTimes(2);
    expect(readme).toContain("Frame mode: blur");
  });

  it("sanitizes filename prefixes before writing archive entries", async () => {
    installCanvasMock();
    const blob = await createImageZip({
      image: {} as HTMLImageElement,
      cells: makeCells(1),
      gutter: 0,
      prefix: "../chapter 1/",
      startNumber: 7,
      digits: 2,
      originalName: "contact.png",
    });
    const archive = await JSZip.loadAsync(await blob.arrayBuffer());

    expect(archive.file("gridsplit-images/..-chapter-1-07.png")).not.toBeNull();
    expect(archive.file("../chapter 1/07.png")).toBeNull();
  });
});
