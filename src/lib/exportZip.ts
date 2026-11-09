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
    ["filename", "row", "column", "x", "y", "width", "height"].join(","),
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
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Your browser could not create an image canvas.");

    context.drawImage(options.image, x, y, width, height, 0, 0, width, height);
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
    ].join(","));
  }

  zip.file("manifest.csv", manifestRows.join("\n"));
  zip.file(
    "README.txt",
    "Images were cropped locally in your browser by GridSplit.\n" +
      "No AI services or remote image-processing server were used.\n" +
      "PNG files preserve the decoded source pixels without additional lossy compression.\n" +
      "Source file: " + options.originalName + "\n",
  );

  return zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 4 },
  });
}