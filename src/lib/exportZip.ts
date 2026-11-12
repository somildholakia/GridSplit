import JSZip from "jszip";

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
  const manifestRows = [
    ["filename", "row", "column", "source_x", "source_y", "source_width", "source_height", "output_width", "output_height"].join(","),
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

    // Preserve the entire extracted scene: fit it inside a 16:9 canvas without stretching or cropping.
    // High-quality browser resampling improves the appearance of enlarged source crops.
    context.fillStyle = "#080b12";
    context.fillRect(0, 0, YOUTUBE_FRAME_WIDTH, YOUTUBE_FRAME_HEIGHT);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    const scale = Math.min(YOUTUBE_FRAME_WIDTH / width, YOUTUBE_FRAME_HEIGHT / height);
    const outputWidth = Math.max(1, Math.round(width * scale));
    const outputHeight = Math.max(1, Math.round(height * scale));
    const outputX = Math.floor((YOUTUBE_FRAME_WIDTH - outputWidth) / 2);
    const outputY = Math.floor((YOUTUBE_FRAME_HEIGHT - outputHeight) / 2);
    context.drawImage(options.image, x, y, width, height, outputX, outputY, outputWidth, outputHeight);

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
    ].join(","));
  }

  zip.file("manifest.csv", manifestRows.join("\n"));
  zip.file(
    "README.txt",
    "Images were cropped locally in your browser by GridSplit.\n" +
      "Every exported image is a 1920x1080 (16:9) PNG for long-form YouTube video.\n" +
      "The complete crop is preserved and centered; non-16:9 crops receive dark letterboxing rather than being stretched or cut off.\n" +
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
