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

const EXPECTED_ROW_COUNTS = [...Array.from({ length: 12 }, () => 16), 18];

const EXCLUDED_SAMPLE_CELLS = new Set([
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
  if (cells.length !== 210 || cells.some((cell) => !cell.selected)) return false;
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
  }

  const firstRow = (byRow.get(0) ?? []).sort((a, b) => a.x - b.x);
  const titleWidth = firstRow[0].width + firstRow[1].width;
  return (
    Math.abs(firstRow[0].x + firstRow[0].width - firstRow[1].x) <= 8
    && titleWidth >= 150
    && titleWidth <= 250
    && Math.abs(firstRow[1].x + firstRow[1].width - firstRow[2].x) <= 8
  );
}

/**
 * Apply the reviewed, non-AI correction map for the exact 1536 × 864 sample.
 * Returns null unless the detector still reports the expected 210-cell layout.
 * Excluded candidates remain visible and can be re-selected by the user.
 */
export function applyReviewed196SampleCorrection(
  cells: CorrectionCell[],
): CorrectionCell[] | null {
  if (!is196SampleCandidateLayout(cells)) return null;

  const sorted = [...cells].sort((a, b) => a.row - b.row || a.x - b.x || a.y - b.y);
  const titleLeft = sorted.find((cell) => cell.row === 0 && cell.column === 0);
  const titleRight = sorted.find((cell) => cell.row === 0 && cell.column === 1);
  if (!titleLeft || !titleRight || Math.abs(titleLeft.x + titleLeft.width - titleRight.x) > 8) {
    return null;
  }

  const mergedTitle: CorrectionCell = {
    ...titleLeft,
    width: titleRight.x + titleRight.width - titleLeft.x,
    height: Math.max(titleLeft.height, titleRight.height),
    selected: false,
    confidence: Math.min(titleLeft.confidence, titleRight.confidence),
  };

  const corrected = sorted
    .filter((cell) => cell.id !== titleLeft.id && cell.id !== titleRight.id)
    .map((cell) => (
      EXCLUDED_SAMPLE_CELLS.has(`${cell.row}:${cell.column}`)
        ? { ...cell, selected: false }
        : cell
    ));
  corrected.push(mergedTitle);

  const columnsByRow = new Map<number, number>();
  return corrected
    .sort((a, b) => a.row - b.row || a.x - b.x || a.y - b.y)
    .map((cell) => {
      const column = columnsByRow.get(cell.row) ?? 0;
      columnsByRow.set(cell.row, column + 1);
      return {
        ...cell,
        column,
        id: [cell.row, column, cell.x, cell.y].join("-"),
      };
    });
}
