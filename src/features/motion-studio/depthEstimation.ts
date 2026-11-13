export interface DepthFocusPoint {
  x: number;
  y: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Creates a deliberately approximate composition-depth field without a model,
 * API, or network call. The chosen focus point is nearer; image edges and the
 * upper part of the frame tend farther away. Local contrast adds subtle detail.
 */
export function createCompositionDepthMap(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  focus: DepthFocusPoint = { x: 0.5, y: 0.45 },
  strength = 0.75,
): Uint8ClampedArray {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2
      || pixels.length !== width * height * 4) {
    throw new Error("Depth estimation received invalid image pixels.");
  }
  const focalX = clamp(focus.x, 0, 1);
  const focalY = clamp(focus.y, 0, 1);
  const amount = clamp(strength, 0, 1);
  const luminance = new Float32Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const offset = i * 4;
    luminance[i] = (pixels[offset] * 0.2126 + pixels[offset + 1] * 0.7152 + pixels[offset + 2] * 0.0722) / 255;
  }

  const raw = new Uint8ClampedArray(width * height);
  const radiusX = 0.42;
  const radiusY = 0.48;
  for (let y = 0; y < height; y += 1) {
    const ny = y / (height - 1);
    for (let x = 0; x < width; x += 1) {
      const nx = x / (width - 1);
      const dx = (nx - focalX) / radiusX;
      const dy = (ny - focalY) / radiusY;
      const focusFalloff = Math.exp(-2.2 * (dx * dx + dy * dy));
      const index = y * width + x;
      const left = luminance[y * width + Math.max(0, x - 1)];
      const right = luminance[y * width + Math.min(width - 1, x + 1)];
      const above = luminance[Math.max(0, y - 1) * width + x];
      const below = luminance[Math.min(height - 1, y + 1) * width + x];
      const localContrast = Math.min(1, (Math.abs(left - right) + Math.abs(above - below)) * 1.8);
      const compositionDepth = 0.18 + focusFalloff * 0.58 + ny * 0.16 + localContrast * 0.08;
      const normalized = 0.5 + (compositionDepth - 0.5) * amount;
      raw[index] = Math.round(clamp(normalized, 0, 1) * 255);
    }
  }

  // A small separable box blur suppresses noisy pixel-level depth changes.
  const horizontal = new Uint8ClampedArray(raw.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let dx = -2; dx <= 2; dx += 1) {
        const sampleX = x + dx;
        if (sampleX < 0 || sampleX >= width) continue;
        sum += raw[y * width + sampleX];
        count += 1;
      }
      horizontal[y * width + x] = Math.round(sum / count);
    }
  }
  const result = new Uint8ClampedArray(raw.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let dy = -2; dy <= 2; dy += 1) {
        const sampleY = y + dy;
        if (sampleY < 0 || sampleY >= height) continue;
        sum += horizontal[sampleY * width + x];
        count += 1;
      }
      result[y * width + x] = Math.round(sum / count);
    }
  }
  return result;
}

export function depthMapToImageData(depth: Uint8ClampedArray, width: number, height: number): ImageData {
  if (depth.length !== width * height) throw new Error("Depth map dimensions do not match its pixels.");
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < depth.length; i += 1) {
    const value = depth[i];
    const offset = i * 4;
    rgba[offset] = value;
    rgba[offset + 1] = value;
    rgba[offset + 2] = value;
    rgba[offset + 3] = 255;
  }
  return new ImageData(rgba, width, height);
}
