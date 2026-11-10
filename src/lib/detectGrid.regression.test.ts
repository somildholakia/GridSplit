import { describe, expect, it } from "vitest";
import { detectContactSheet, makeEvenBoundaries } from "./detectGrid";

function flatImage(width: number, height: number, shade: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = shade; data[offset + 1] = shade; data[offset + 2] = shade; data[offset + 3] = 255;
  }
  return { width, height, data, colorSpace: "srgb" } as ImageData;
}

describe("GridSplit extractor regression fixtures", () => {
  it.each([0, 32, 127, 255])("retains one full-canvas fallback crop for a flat %i-shade sheet", (shade) => {
    const input = flatImage(320, 240, shade);
    const first = detectContactSheet(input);
    const second = detectContactSheet(input);
    expect(first).toEqual(second);
    expect(first.cells).toHaveLength(1);
    expect(first.cells[0]).toMatchObject({ x: 0, y: 0, width: 320, height: 240 });
    expect(first.horizontalConfidence).toBeGreaterThanOrEqual(0);
    expect(first.horizontalConfidence).toBeLessThanOrEqual(100);
    expect(first.verticalConfidence).toBeGreaterThanOrEqual(0);
    expect(first.verticalConfidence).toBeLessThanOrEqual(100);
  });

  it("keeps generated even-grid boundaries monotonic and fully covering for supported counts", () => {
    for (let size = 1; size <= 257; size += 1) {
      for (let count = 1; count <= 60; count += 1) {
        const boundaries = makeEvenBoundaries(size, count);
        expect(boundaries[0]).toBe(0);
        expect(boundaries.at(-1)).toBe(size);
        expect(boundaries).toHaveLength(count + 1);
        for (let index = 1; index < boundaries.length; index += 1) {
          expect(boundaries[index]).toBeGreaterThanOrEqual(boundaries[index - 1]);
        }
      }
    }
  });
});
