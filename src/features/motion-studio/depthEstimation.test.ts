import { describe, expect, it } from "vitest";
import { createCompositionDepthMap } from "./depthEstimation";

function flatImage(width: number, height: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    pixels[i * 4] = 100;
    pixels[i * 4 + 1] = 120;
    pixels[i * 4 + 2] = 140;
    pixels[i * 4 + 3] = 255;
  }
  return pixels;
}

describe("local composition depth estimation", () => {
  it("creates a bounded grayscale depth field without external models", () => {
    const map = createCompositionDepthMap(flatImage(32, 24), 32, 24);
    expect(map).toHaveLength(32 * 24);
    expect(Math.min(...map)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...map)).toBeLessThanOrEqual(255);
    expect(new Set(map).size).toBeGreaterThan(3);
  });

  it("moves the estimated near plane toward the chosen focus point", () => {
    const pixels = flatImage(40, 30);
    const leftFocus = createCompositionDepthMap(pixels, 40, 30, { x: 0.2, y: 0.5 });
    const rightFocus = createCompositionDepthMap(pixels, 40, 30, { x: 0.8, y: 0.5 });
    const sample = (map: Uint8ClampedArray, x: number, y: number) => map[y * 40 + x];
    expect(sample(leftFocus, 8, 15)).toBeGreaterThan(sample(leftFocus, 32, 15));
    expect(sample(rightFocus, 32, 15)).toBeGreaterThan(sample(rightFocus, 8, 15));
  });

  it("rejects malformed image data and clamps focus values", () => {
    expect(() => createCompositionDepthMap(new Uint8ClampedArray(3), 2, 2)).toThrow();
    const map = createCompositionDepthMap(flatImage(8, 8), 8, 8, { x: 5, y: -2 }, 4);
    expect(map).toHaveLength(64);
  });
});
