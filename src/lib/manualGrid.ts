import type { ExportCell } from "./exportZip";

/**
 * Build crop rectangles from full-width horizontal cuts and independent
 * vertical cuts for each row. Every row may have a different number and
 * position of vertical boundaries.
 */
export function buildCellsFromGuides(
  width: number,
  height: number,
  verticalCutsByRow: number[][],
  horizontalCuts: number[],
): ExportCell[] {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return [];

  const yBoundaries = [...new Set([
    0,
    ...horizontalCuts.filter((cut) => Number.isFinite(cut) && cut > 0 && cut < height),
    height,
  ])].sort((top, bottom) => top - bottom);

  const cells: ExportCell[] = [];
  for (let row = 0; row < yBoundaries.length - 1; row += 1) {
    const rowCuts = verticalCutsByRow[row] ?? [];
    const xBoundaries = [...new Set([
      0,
      ...rowCuts.filter((cut) => Number.isFinite(cut) && cut > 0 && cut < width),
      width,
    ])].sort((left, right) => left - right);
    const y = yBoundaries[row];
    const rowHeight = yBoundaries[row + 1] - y;

    for (let column = 0; column < xBoundaries.length - 1; column += 1) {
      const x = xBoundaries[column];
      cells.push({
        row,
        column,
        x,
        y,
        width: xBoundaries[column + 1] - x,
        height: rowHeight,
      });
    }
  }
  return cells;
}
