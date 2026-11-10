import { describe, expect, it } from "vitest";
import {
  applyReviewed196SampleCorrection,
  is196SampleCandidateLayout,
  type CorrectionCell,
} from "./sampleCorrections";

function candidateCells(): CorrectionCell[] {
  const cells: CorrectionCell[] = [];
  for (let row = 0; row < 13; row += 1) {
    const count = row === 12 ? 18 : 16;
    const width = row === 12 ? 84 : 96;
    for (let column = 0; column < count; column += 1) {
      cells.push({
        id: `${row}-${column}`,
        row,
        column,
        x: column * width,
        y: row * 70,
        width,
        height: 70,
        selected: true,
        confidence: 0.9,
      });
    }
  }
  // The first two detector candidates are the two halves of the wide title card.
  cells[0].width = 90;
  cells[1].x = 90;
  cells[1].width = 90;
  return cells;
}

describe("reviewed 196-image sample correction", () => {
  it("recognizes only the exact expected 210-candidate row shape", () => {
    expect(is196SampleCandidateLayout(candidateCells())).toBe(true);
    expect(is196SampleCandidateLayout(candidateCells().slice(1))).toBe(false);

    const edited = candidateCells();
    edited[20].selected = false;
    expect(is196SampleCandidateLayout(edited)).toBe(false);
  });

  it("merges the title halves and leaves exactly 196 crops selected", () => {
    const corrected = applyReviewed196SampleCorrection(candidateCells());
    expect(corrected).not.toBeNull();
    expect(corrected).toHaveLength(209);

    const selected = corrected!.filter((cell) => cell.selected);
    expect(selected).toHaveLength(196);

    const title = corrected!.find((cell) => cell.row === 0 && cell.column === 0);
    expect(title).toMatchObject({ x: 0, width: 180, selected: false });

    const excludedCoordinates = [
      [1, 10], [2, 12], [3, 14], [4, 10], [5, 11], [6, 13],
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

  it("refuses a non-adjacent or changed title layout", () => {
    const cells = candidateCells();
    cells[1].x += 20;
    expect(applyReviewed196SampleCorrection(cells)).toBeNull();
  });
});
