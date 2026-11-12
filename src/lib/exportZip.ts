import JSZip from "jszip";
import { drawCropToFrame, type FrameFitMode } from "./frameRenderer";

export type ExportCell = {
  row: number;
  column: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ExportOptions = {
  image: HTMLImageElement;
  cells: ExportCell[];
  gutter: number;
  prefix: string;
  startNumber: number;
  digits: number;
  originalName: string;
  fitMode?: FrameFitMode;
  backgroundColor?: string;
};

/** Standard landscape frame for long-form YouTube videos. */
export const YOUTUBE_FRAME_WIDTH = 1920;
export const YOUTUBE_FRAME_HEIGHT = 1080;

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("The browser could not encode one of the cropped images."));
    }, "image/png");
  });
}

function csvEscape(value: string | number): string {
  const text = String(value);
  return '"' + text.replaceAll('"', '""') + '"';
}

export async function createImageZip(options: ExportOptions): Promise<Blob> {
  const zip = new JSZip();
  const folder = zip.folder("gridsplit-images");
  if (!folder) throw new Error("Could not create the ZIP folder.");

  const safePrefix = options.prefix.trim().replace(/[^a-zA-Z0-9_.-]/g, "-") || "frame-";
  const fitMode = options.fitMode ?? "contain";
  const backgroundColor = options.backgroundColor ?? "#080b12";
  const manifestRows = [
    ["filename", "row", "column", "source_x", "source_y", "source_width", "source_height", "output_width", "output_height", "frame_mode"].join(","),
  ];

  for (let index = 0; index < options.cells.length; index += 1) {
    const cell = options.cells[index];
    const padding = Math.min(
      options.gutter,
      Math.floor(Math.min(cell.width, cell.height) / 8),
    );
    const x = Math.max(0, Math.round(cell.x + padding));
    const y = Math.max(0, Math.round(cell.y + padding));
    const width = Math.max(1, Math.round(cell.width - padding * 2));
    const height = Math.max(1, Math.round(cell.height - padding * 2));
    const canvas = document.createElement("canvas");
    canvas.width = YOUTUBE_FRAME_WIDTH;
    canvas.height = YOUTUBE_FRAME_HEIGHT;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Your browser could not create an image canvas.");

    drawCropToFrame(
      context,
      options.image,
      { x, y, width, height },
      YOUTUBE_FRAME_WIDTH,
      YOUTUBE_FRAME_HEIGHT,
      fitMode,
      backgroundColor,
    );

    const blob = await canvasToPng(canvas);
    const number = String(Math.floor(options.startNumber) + index).padStart(options.digits, "0");
    const filename = safePrefix + number + ".png";
    folder.file(filename, blob);

    manifestRows.push([
      csvEscape(filename),
      cell.row + 1,
      cell.column + 1,
      x,
      y,
      width,
      height,
      YOUTUBE_FRAME_WIDTH,
      YOUTUBE_FRAME_HEIGHT,
      fitMode,
    ].join(","));
  }

  zip.file("manifest.csv", manifestRows.join("\n"));
  zip.file(
    "README.txt",
    "Images were cropped locally in your browser by GridSplit.\n" +
      "Every exported image is a 1920x1080 (16:9) PNG for long-form YouTube video.\n" +
      "Frame mode: " + fitMode + ". Contain preserves every crop pixel, cover fills the frame by cropping edges, and blur fills the background with a softened copy while keeping the full crop sharp in front.\n" +
      "The manifest.csv records each source crop and frame mode.\n" +
      "High-quality browser resampling is used when enlarging small crops; this is not AI detail reconstruction.\n" +
      "No images were uploaded to a server.\n" +
      "Source file: " + options.originalName + "\n",
  );

  return zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 4 },
  });
}
