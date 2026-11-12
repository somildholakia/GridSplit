import type { ExportCell } from "./exportZip";

/**
 * Convert independently positioned guide coordinates into rectangular crop
 * regions. Uneven spacing is intentional: each resulting frame may have a
 * different source size before it is normalized to the final video frame.
 */
export function buildCellsFromGuides(
  width: number,
  height: number,
  verticalCuts: number[],
  horizontalCuts: number[],
): ExportCell[] {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return [];

  const xBoundaries = [...new Set([
    0,
    ...verticalCuts.filter((cut) => Number.isFinite(cut) && cut > 0 && cut < width),
    width,
  ])].sort((left, right) => left - right);
  const yBoundaries = [...new Set([
    0,
    ...horizontalCuts.filter((cut) => Number.isFinite(cut) && cut > 0 && cut < height),
    height,
  ])].sort((top, bottom) => top - bottom);

  const cells: ExportCell[] = [];
  for (let row = 0; row < yBoundaries.length - 1; row += 1) {
    for (let column = 0; column < xBoundaries.length - 1; column += 1) {
      const x = xBoundaries[column];
      const y = yBoundaries[row];
      cells.push({
        row,
        column,
        x,
        y,
        width: xBoundaries[column + 1] - x,
        height: yBoundaries[row + 1] - y,
      });
    }
  }
  return cells;
}
