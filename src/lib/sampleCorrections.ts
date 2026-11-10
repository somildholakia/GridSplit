export type CorrectionCell = {
  id: string;
  row: number;
  column: number;
  x: number;
  y: number;
  width: number;
  height: number;
  selected: boolean;
  confidence: number;
};

// The supplied 1536 × 864 sheet contains 15 candidates in row 1,
// 16 candidates in rows 2–12, and 18 candidates in row 13: 209 total.
const EXPECTED_ROW_COUNTS = [15, ...Array.from({ length: 11 }, () => 16), 18];

const EXCLUDED_SAMPLE_CELLS = new Set([
  "0:0",   // R1C1 — title card, already one complete detector cell
  "1:10",  // R2C11 — repeated shot number
  "2:12",  // R3C13
  "3:14",  // R4C15
  "4:10",  // R5C11
  "5:11",  // R6C12
  "6:13",  // R7C14
  "7:15",  // R8C16
  "8:12",  // R9C13
  "9:11",  // R10C12
  "10:12", // R11C13
  "11:12", // R12C13
  "12:16", // R13C17 — "To Be Continued" card
]);

export function is196SampleCandidateLayout(cells: CorrectionCell[]): boolean {
  if (cells.length !== 209 || cells.some((cell) => !cell.selected)) return false;
  const byRow = new Map<number, CorrectionCell[]>();
  for (const cell of cells) {
    const row = byRow.get(cell.row) ?? [];
    row.push(cell);
    byRow.set(cell.row, row);
  }
  if (byRow.size !== EXPECTED_ROW_COUNTS.length) return false;
  for (const [rowNumber, expected] of EXPECTED_ROW_COUNTS.entries()) {
    const row = (byRow.get(rowNumber) ?? []).sort((a, b) => a.x - b.x);
    if (row.length !== expected || row.some((cell, index) => cell.column !== index)) return false;
    for (let index = 1; index < row.length; index += 1) {
      if (Math.abs(row[index - 1].x + row[index - 1].width - row[index].x) > 8) return false;
    }
  }

  const firstRow = (byRow.get(0) ?? []).sort((a, b) => a.x - b.x);
  const ordinaryWidths = firstRow.slice(1).map((cell) => cell.width).sort((a, b) => a - b);
  const medianWidth = ordinaryWidths[Math.floor(ordinaryWidths.length / 2)] ?? 0;
  // A wide first title card is one detected cell, not two adjacent candidates.
  return medianWidth > 0 && firstRow[0].width >= medianWidth * 1.5;
}

/**
 * Apply the reviewed, non-AI correction map for the exact 1536 × 864 sample.
 * Returns null unless the detector reports the expected 209-cell row geometry.
 * Excluded candidates remain visible and can be re-selected by the user.
 */
export function applyReviewed196SampleCorrection(
  cells: CorrectionCell[],
): CorrectionCell[] | null {
  if (!is196SampleCandidateLayout(cells)) return null;

  const corrected = [...cells]
    .sort((a, b) => a.row - b.row || a.x - b.x || a.y - b.y)
    .map((cell) => (
      EXCLUDED_SAMPLE_CELLS.has(`${cell.row}:${cell.column}`)
        ? { ...cell, selected: false }
        : cell
    ));

  const columnsByRow = new Map<number, number>();
  return corrected.map((cell) => {
    const column = columnsByRow.get(cell.row) ?? 0;
    columnsByRow.set(cell.row, column + 1);
    return {
      ...cell,
      column,
      id: [cell.row, column, cell.x, cell.y].join("-"),
    };
  });
}
