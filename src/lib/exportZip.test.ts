import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createImageZip, type ExportCell } from "./exportZip";

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
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ({ drawImage })),
    toBlob: vi.fn((callback: BlobCallback) => {
      callback(new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }));
    }),
  };
  vi.stubGlobal("document", {
    createElement: vi.fn(() => canvas),
  });
  return { drawImage, canvas };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("contact-sheet image ZIP export", () => {
  it("writes exactly 196 uniquely numbered PNG crops and one manifest row per crop", async () => {
    const { drawImage, canvas } = installCanvasMock();
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
    expect(manifest?.trim().split("\\n")).toHaveLength(count + 1);
    expect(manifest).toContain('"frame-001.png",1,1,2,2,96,76');
    expect(manifest).toContain('"frame-196.png",14,14,1302,1042,96,76');
    expect(drawImage).toHaveBeenCalledTimes(count);
    expect(canvas.toBlob).toHaveBeenCalledTimes(count);
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
