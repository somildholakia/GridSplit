import { describe, expect, it } from "vitest";
import {
  applyReviewed196SampleCorrection,
  is196SampleCandidateLayout,
  type CorrectionCell,
} from "./sampleCorrections";

function candidateCells(): CorrectionCell[] {
  const cells: CorrectionCell[] = [];
  for (let row = 0; row < 13; row += 1) {
    const count = row === 0 ? 15 : row === 12 ? 18 : 16;
    for (let column = 0; column < count; column += 1) {
      const width = row === 0 && column === 0 ? 180 : row === 12 ? 84 : 96;
      const x = row === 0 && column >= 1
        ? 180 + (column - 1) * 96
        : row === 0 ? 0 : column * 96;
      cells.push({
        id: `${row}-${column}`,
        row,
        column,
        x,
        y: row * 70,
        width,
        height: 70,
        selected: true,
        confidence: 0.9,
      });
    }
  }
  return cells;
}

describe("reviewed 196-image sample correction", () => {
  it("recognizes the exact 209-candidate row shape", () => {
    const candidates = candidateCells();
    expect(candidates).toHaveLength(209);
    expect(is196SampleCandidateLayout(candidates)).toBe(true);
    expect(is196SampleCandidateLayout(candidates.slice(1))).toBe(false);

    const edited = candidateCells();
    edited[20].selected = false;
    expect(is196SampleCandidateLayout(edited)).toBe(false);
  });

  it("excludes the title, repeated-number panels and continuation card, leaving 196 crops", () => {
    const corrected = applyReviewed196SampleCorrection(candidateCells());
    expect(corrected).not.toBeNull();
    expect(corrected).toHaveLength(209);

    const selected = corrected!.filter((cell) => cell.selected);
    expect(selected).toHaveLength(196);

    const title = corrected!.find((cell) => cell.row === 0 && cell.column === 0);
    expect(title).toMatchObject({ x: 0, width: 180, selected: false });

    const excludedCoordinates = [
      [0, 0], [1, 10], [2, 12], [3, 14], [4, 10], [5, 11], [6, 13],
      [7, 15], [8, 12], [9, 11], [10, 12], [11, 12], [12, 16],
    ];
    for (const [row, column] of excludedCoordinates) {
      const original = candidateCells().find((cell) => cell.row === row && cell.column === column)!;
      const correctedCell = corrected!.find((cell) => cell.x === original.x && cell.y === original.y);
      expect(correctedCell?.selected).toBe(false);
    }

    const selectedPerRow = Array.from({ length: 13 }, (_, row) =>
      selected.filter((cell) => cell.row === row).length,
    );
    expect(selectedPerRow).toEqual([14, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 17]);
  });

  it("refuses a changed candidate count or malformed row geometry", () => {
    const cells = candidateCells();
    cells[1].x += 20;
    expect(applyReviewed196SampleCorrection(cells)).toBeNull();

    const wrongCount = candidateCells();
    wrongCount.pop();
    expect(applyReviewed196SampleCorrection(wrongCount)).toBeNull();
  });
});
