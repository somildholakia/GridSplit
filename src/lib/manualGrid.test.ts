import { describe, expect, it } from "vitest";
import { buildCellsFromGuides } from "./manualGrid";

describe("manual guide grid", () => {
  it("keeps vertical cuts independent for every row", () => {
    const cells = buildCellsFromGuides(
      1000,
      600,
      [[180, 710], [280], [420, 700]],
      [140, 390],
    );

    expect(cells).toHaveLength(8);
    expect(cells.filter((cell) => cell.row === 0)).toEqual([
      { row: 0, column: 0, x: 0, y: 0, width: 180, height: 140 },
      { row: 0, column: 1, x: 180, y: 0, width: 530, height: 140 },
      { row: 0, column: 2, x: 710, y: 0, width: 290, height: 140 },
    ]);
    expect(cells.filter((cell) => cell.row === 1)).toEqual([
      { row: 1, column: 0, x: 0, y: 140, width: 280, height: 250 },
      { row: 1, column: 1, x: 280, y: 140, width: 720, height: 250 },
    ]);
    expect(cells.filter((cell) => cell.row === 2)).toEqual([
      { row: 2, column: 0, x: 0, y: 390, width: 420, height: 210 },
      { row: 2, column: 1, x: 420, y: 390, width: 280, height: 210 },
      { row: 2, column: 2, x: 700, y: 390, width: 300, height: 210 },
    ]);
  });

  it("sorts and de-duplicates each row's coordinates and ignores out-of-bounds cuts", () => {
    const cells = buildCellsFromGuides(
      100,
      80,
      [[75, 20, 20, 0, 100, -2], [40, 40, 90]],
      [40, 40, 90],
    );

    expect(cells).toHaveLength(6);
    expect(cells.filter((cell) => cell.row === 0).map((cell) => cell.width))
      .toEqual([20, 55, 25]);
    expect(cells.filter((cell) => cell.row === 1).map((cell) => cell.width))
      .toEqual([40, 50, 10]);
  });

  it("handles rows with no internal vertical guides and rejects invalid dimensions", () => {
    expect(buildCellsFromGuides(1920, 1080, [[]], [])).toEqual([
      { row: 0, column: 0, x: 0, y: 0, width: 1920, height: 1080 },
    ]);
    expect(buildCellsFromGuides(0, 1080, [[200]], [])).toEqual([]);
  });

  it("fills any row without a supplied guide list as one full-width crop", () => {
    expect(buildCellsFromGuides(100, 80, [[50]], [40])).toEqual([
      { row: 0, column: 0, x: 0, y: 0, width: 50, height: 40 },
      { row: 0, column: 1, x: 50, y: 0, width: 50, height: 40 },
      { row: 1, column: 0, x: 0, y: 40, width: 100, height: 40 },
    ]);
  });
});
