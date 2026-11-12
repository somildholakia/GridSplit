export type FrameFitMode = "contain" | "cover" | "blur";

export type CropRectangle = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Paint one crop into a fixed-aspect frame without stretching the source.
 * "contain" preserves every source pixel, "cover" fills and crops the edges,
 * and "blur" uses a softened full-bleed copy behind a sharp contained image.
 */
export function drawCropToFrame(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  crop: CropRectangle,
  frameWidth: number,
  frameHeight: number,
  mode: FrameFitMode = "contain",
  backgroundColor = "#080b12",
): void {
  const safeWidth = Math.max(1, crop.width);
  const safeHeight = Math.max(1, crop.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.fillStyle = backgroundColor;
  context.fillRect(0, 0, frameWidth, frameHeight);

  const containScale = Math.min(frameWidth / safeWidth, frameHeight / safeHeight);
  const coverScale = Math.max(frameWidth / safeWidth, frameHeight / safeHeight);

  if (mode === "blur") {
    const backgroundScale = coverScale * 1.08;
    const backgroundWidth = safeWidth * backgroundScale;
    const backgroundHeight = safeHeight * backgroundScale;
    const backgroundX = (frameWidth - backgroundWidth) / 2;
    const backgroundY = (frameHeight - backgroundHeight) / 2;
    context.save();
    context.filter = "blur(" + Math.max(1, Math.round(frameWidth * 0.014)) + "px)";
    context.drawImage(
      source,
      crop.x,
      crop.y,
      safeWidth,
      safeHeight,
      backgroundX,
      backgroundY,
      backgroundWidth,
      backgroundHeight,
    );
    context.restore();
    context.fillStyle = "rgba(8, 11, 18, 0.22)";
    context.fillRect(0, 0, frameWidth, frameHeight);
  }

  const scale = mode === "cover" ? coverScale : containScale;
  const outputWidth = safeWidth * scale;
  const outputHeight = safeHeight * scale;
  const outputX = (frameWidth - outputWidth) / 2;
  const outputY = (frameHeight - outputHeight) / 2;
  context.drawImage(
    source,
    crop.x,
    crop.y,
    safeWidth,
    safeHeight,
    outputX,
    outputY,
    outputWidth,
    outputHeight,
  );
}
