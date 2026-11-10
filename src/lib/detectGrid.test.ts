import { describe, expect, it } from "vitest";
import { countCells, detectContactSheet, makeEvenBoundaries } from "./detectGrid";

describe("GridSplit boundary helpers", () => {
  it("creates evenly spaced integer boundaries that cover the full axis", () => {
    expect(makeEvenBoundaries(100, 3)).toEqual([0, 33, 67, 100]);
    expect(makeEvenBoundaries(0, 4)).toEqual([0, 0, 0, 0, 0]);
    expect(makeEvenBoundaries(100, 0)).toEqual([0, 100]);
  });

  it("counts intervals and handles empty boundary arrays", () => {
    expect(countCells([0, 50, 100])).toBe(2);
    expect(countCells([0])).toBe(0);
    expect(countCells([])).toBe(0);
  });

  it("keeps a featureless image as one valid fallback crop", () => {
    const width = 320;
    const height = 240;
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    const imageData = { width, height, data, colorSpace: "srgb" } as ImageData;
    const layout = detectContactSheet(imageData);

    expect(layout.rows).toHaveLength(1);
    expect(layout.cells).toHaveLength(1);
    expect(layout.cells[0]).toMatchObject({
      x: 0,
      y: 0,
      width,
      height,
    });
    expect(layout.verticalConfidence).toBeGreaterThanOrEqual(0);
    expect(layout.verticalConfidence).toBeLessThanOrEqual(100);
  });
});
