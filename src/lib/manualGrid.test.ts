import { describe, expect, it } from "vitest";
import { buildCellsFromGuides } from "./manualGrid";

describe("manual guide grid", () => {
  it("creates uneven crop sizes from user-positioned cuts", () => {
    const cells = buildCellsFromGuides(1000, 600, [180, 710], [140, 390]);

    expect(cells).toHaveLength(9);
    expect(cells.slice(0, 3)).toEqual([
      { row: 0, column: 0, x: 0, y: 0, width: 180, height: 140 },
      { row: 0, column: 1, x: 180, y: 0, width: 530, height: 140 },
      { row: 0, column: 2, x: 710, y: 0, width: 290, height: 140 },
    ]);
    expect(cells[3]).toEqual({ row: 1, column: 0, x: 0, y: 140, width: 180, height: 250 });
    expect(cells[8]).toEqual({ row: 2, column: 2, x: 710, y: 390, width: 290, height: 210 });
  });

  it("sorts and de-duplicates guide coordinates and ignores out-of-bounds cuts", () => {
    const cells = buildCellsFromGuides(100, 80, [75, 20, 20, 0, 100, -2], [40, 40, 90]);

    expect(cells).toHaveLength(6);
    expect(cells.map((cell) => cell.width)).toEqual([20, 55, 25, 20, 55, 25]);
    expect(cells.map((cell) => cell.height)).toEqual([40, 40, 40, 40, 40, 40]);
  });

  it("handles a grid with no internal guides and rejects invalid dimensions", () => {
    expect(buildCellsFromGuides(1920, 1080, [], [])).toEqual([
      { row: 0, column: 0, x: 0, y: 0, width: 1920, height: 1080 },
    ]);
    expect(buildCellsFromGuides(0, 1080, [200], [])).toEqual([]);
  });
});
