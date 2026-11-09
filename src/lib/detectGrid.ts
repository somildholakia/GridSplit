export type GridCell = {
  row: number;
  column: number;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
};

export type GridRow = {
  row: number;
  top: number;
  bottom: number;
  period: number;
  confidence: number;
  boundaries: number[];
};

export type ContactSheetLayout = {
  rows: GridRow[];
  cells: GridCell[];
  horizontalConfidence: number;
  verticalConfidence: number;
};

type Peak = { position: number; score: number };
type Candidate = { position: number; zScore: number };

function luminance(data: Uint8ClampedArray, width: number, x: number, y: number): number {
  const index = (y * width + x) * 4;
  return data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
}

function smooth(values: Float32Array): Float32Array {
  const result = new Float32Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    let total = 0;
    let weight = 0;
    for (let offset = -2; offset <= 2; offset += 1) {
      const index = i + offset;
      if (index < 0 || index >= values.length) continue;
      const w = offset === 0 ? 3 : Math.abs(offset) === 1 ? 2 : 1;
      total += values[index] * w;
      weight += w;
    }
    result[i] = total / weight;
  }
  return result;
}

function axisProfile(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  vertical: boolean,
  top = 0,
  bottom = height,
): Float32Array {
  const axisLength = vertical ? width : height;
  const crossStart = vertical ? top : 0;
  const crossEnd = vertical ? bottom : width;
  const crossLength = Math.max(1, crossEnd - crossStart);
  const scores = new Float32Array(axisLength);
  const sampleStep = Math.max(1, Math.floor(crossLength / 700));

  for (let axis = 2; axis < axisLength - 2; axis += 1) {
    let total = 0;
    let darkBorderHits = 0;
    let samples = 0;

    for (let cross = crossStart + 1; cross < crossEnd - 1; cross += sampleStep) {
      const left = vertical
        ? luminance(data, width, axis - 1, cross)
        : luminance(data, width, cross, axis - 1);
      const current = vertical
        ? luminance(data, width, axis, cross)
        : luminance(data, width, cross, axis);
      const right = vertical
        ? luminance(data, width, axis + 1, cross)
        : luminance(data, width, cross, axis + 1);

      const contrast = (Math.abs(current - left) + Math.abs(current - right)) * 0.5;
      const darkBorder = current < 82 && current + 9 < left && current + 9 < right;
      total += contrast + (darkBorder ? 18 : 0);
      if (darkBorder) darkBorderHits += 1;
      samples += 1;
    }

    scores[axis] = samples > 0
      ? total / samples + (darkBorderHits / samples) * 12
      : 0;
  }

  return smooth(scores);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function findHorizontalPeaks(profile: Float32Array, axisLength: number): Peak[] {
  const interior = Array.from(profile).slice(
    Math.floor(axisLength * 0.015),
    Math.ceil(axisLength * 0.985),
  );
  const baseline = median(interior);
  const deviations = interior.map((value) => Math.abs(value - baseline));
  const mad = median(deviations);
  const threshold = baseline + Math.max(2.2, mad * 1.35);
  const minDistance = Math.max(5, Math.round(axisLength * 0.045));
  const candidates: Peak[] = [];

  for (let i = 3; i < profile.length - 3; i += 1) {
    const score = profile[i];
    if (score < threshold) continue;
    if (score < profile[i - 1] || score < profile[i + 1]) continue;
    if (score < profile[i - 2] || score < profile[i + 2]) continue;
    candidates.push({ position: i, score });
  }

  candidates.sort((a, b) => b.score - a.score);
  const selected: Peak[] = [];
  for (const candidate of candidates) {
    if (selected.every((peak) => Math.abs(peak.position - candidate.position) >= minDistance)) {
      selected.push(candidate);
    }
    if (selected.length >= 38) break;
  }

  return selected.sort((a, b) => a.position - b.position);
}

function detectHorizontalBoundaries(imageData: ImageData): { boundaries: number[]; confidence: number } {
  const profile = axisProfile(
    imageData.data,
    imageData.width,
    imageData.height,
    false,
  );
  const peaks = findHorizontalPeaks(profile, imageData.height);
  const lines = [
    0,
    ...peaks
      .map((peak) => peak.position)
      .filter((line) => line > 3 && line < imageData.height - 3),
    imageData.height,
  ];
  const meanStrength = peaks.length
    ? peaks.reduce((sum, peak) => sum + peak.score, 0) / peaks.length
    : 0;

  return {
    boundaries: Array.from(new Set(lines)).sort((a, b) => a - b),
    confidence: Math.max(0, Math.min(100, Math.round((meanStrength / 72) * 100))),
  };
}

function estimateTilePeriod(profile: Float32Array): number {
  let mean = 0;
  for (const value of profile) mean += value;
  mean /= profile.length;
  const centered = Array.from(profile, (value) => value - mean);
  const minLag = 65;
  const maxLag = Math.min(130, Math.floor(profile.length / 3));
  let bestLag = 96;
  let bestCorrelation = -Infinity;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let dot = 0;
    let leftEnergy = 0;
    let rightEnergy = 0;

    for (let index = 0; index < centered.length - lag; index += 1) {
      const left = centered[index];
      const right = centered[index + lag];
      dot += left * right;
      leftEnergy += left * left;
      rightEnergy += right * right;
    }

    const denominator = Math.sqrt(leftEnergy * rightEnergy);
    const correlation = denominator > 0 ? dot / denominator : -1;
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }

  return bestLag;
}

function findVerticalCandidates(profile: Float32Array): Candidate[] {
  const interior = Array.from(profile).slice(4, -4);
  const baseline = median(interior);
  const mad = Math.max(1, median(interior.map((value) => Math.abs(value - baseline))));
  const threshold = baseline + mad * 1.8;
  const candidates: Candidate[] = [];

  for (let x = 4; x < profile.length - 4; x += 1) {
    const score = profile[x];
    if (score < threshold) continue;
    if (score < profile[x - 1] || score < profile[x + 1]) continue;
    if (score < profile[x - 2] || score < profile[x + 2]) continue;
    candidates.push({ position: x, zScore: (score - baseline) / mad });
  }

  return candidates
    .filter((candidate) => candidate.position >= 8 && candidate.position <= profile.length - 8)
    .sort((a, b) => b.zScore - a.zScore)
    .slice(0, 80)
    .sort((a, b) => a.position - b.position);
}

function selectBoundaries(
  candidates: Candidate[],
  width: number,
  period: number,
): { boundaries: number[]; confidence: number } {
  type Node = {
    position: number;
    zScore: number;
    isEdge: boolean;
  };

  const nodes: Node[] = [
    { position: 0, zScore: 0, isEdge: true },
    ...candidates.map((candidate) => ({
      position: candidate.position,
      zScore: candidate.zScore,
      isEdge: false,
    })),
    { position: width, zScore: 0, isEdge: true },
  ].sort((a, b) => a.position - b.position);

  const scores = new Array<number>(nodes.length).fill(Number.NEGATIVE_INFINITY);
  const previous = new Array<number>(nodes.length).fill(-1);
  scores[0] = 0;

  for (let current = 1; current < nodes.length; current += 1) {
    for (let prior = 0; prior < current; prior += 1) {
      const gap = nodes[current].position - nodes[prior].position;
      if (gap < period * 0.6 || gap > period * 2.5) continue;

      const multiple = Math.max(1, Math.round(gap / period));
      const residual = Math.abs(gap - multiple * period);
      if (residual > Math.max(24, period * 0.45)) continue;

      const residualPenalty = (residual / (period * 0.14)) ** 2 * 0.25;
      const skippedCellPenalty = (multiple - 1) * 2.3;
      const lineReward = nodes[current].isEdge
        ? 0
        : Math.min(nodes[current].zScore, 14) * 0.8;
      const candidateScore = scores[prior] + lineReward - residualPenalty - skippedCellPenalty;

      if (candidateScore > scores[current]) {
        scores[current] = candidateScore;
        previous[current] = prior;
      }
    }
  }

  const lastIndex = nodes.length - 1;
  if (previous[lastIndex] === -1) {
    const rankedFallback = candidates
      .filter((candidate) => candidate.zScore >= 4.5)
      .sort((a, b) => b.zScore - a.zScore);
    const selectedFallback: Candidate[] = [];

    for (const candidate of rankedFallback) {
      if (selectedFallback.every((selected) =>
        Math.abs(selected.position - candidate.position) >= Math.max(18, period * 0.55)
      )) {
        selectedFallback.push(candidate);
      }
    }

    const interior = selectedFallback
      .map((candidate) => candidate.position)
      .filter((position) => position > 8 && position < width - 8)
      .sort((a, b) => a - b);
    return {
      boundaries: [0, ...interior, width],
      confidence: 25,
    };
  }

  const path: number[] = [];
  let cursor = lastIndex;
  while (cursor !== -1) {
    path.push(cursor);
    cursor = previous[cursor];
  }
  path.reverse();

  const selected = path
    .filter((index) => !nodes[index].isEdge)
    .map((index) => nodes[index].position);
  const confidence = selected.length
    ? Math.max(0, Math.min(100, Math.round(
      selected.reduce((sum, position) => {
        const candidate = candidates.find((item) => item.position === position);
        return sum + Math.min(candidate?.zScore ?? 0, 14);
      }, 0) / selected.length / 14 * 100,
    )))
    : 0;

  return {
    boundaries: [0, ...selected, width],
    confidence,
  };
}

function isBlankFooterBand(
  data: Uint8ClampedArray,
  width: number,
  imageHeight: number,
  top: number,
  bottom: number,
): boolean {
  // Only treat a short, dark strip touching the very bottom as footer padding.
  // Dark fantasy frames inside the sheet must remain eligible image rows.
  if (bottom !== imageHeight || bottom - top > 64) return false;

  let total = 0;
  let darkPixels = 0;
  let samples = 0;

  for (let y = top; y < bottom; y += 2) {
    for (let x = 0; x < width; x += 4) {
      const value = luminance(data, width, x, y);
      total += value;
      if (value < 25) darkPixels += 1;
      samples += 1;
    }
  }

  if (samples === 0) return true;
  const average = total / samples;
  const darkRatio = darkPixels / samples;
  return average < 22 && darkRatio > 0.78;
}

export function detectContactSheet(imageData: ImageData): ContactSheetLayout {
  const horizontal = detectHorizontalBoundaries(imageData);
  const rows: GridRow[] = [];
  const cells: GridCell[] = [];
  const rowConfidences: number[] = [];

  for (let rowIndex = 0; rowIndex < horizontal.boundaries.length - 1; rowIndex += 1) {
    const top = horizontal.boundaries[rowIndex];
    const bottom = horizontal.boundaries[rowIndex + 1];
    if (bottom - top < 18) continue;
    if (isBlankFooterBand(imageData.data, imageData.width, imageData.height, top, bottom)) continue;

    const profile = axisProfile(
      imageData.data,
      imageData.width,
      imageData.height,
      true,
      top,
      bottom,
    );
    const period = estimateTilePeriod(profile);
    const candidates = findVerticalCandidates(profile);
    const selected = selectBoundaries(candidates, imageData.width, period);
    const boundaries = selected.boundaries;

    const row: GridRow = {
      row: rows.length,
      top,
      bottom,
      period,
      confidence: selected.confidence,
      boundaries,
    };
    rows.push(row);
    rowConfidences.push(selected.confidence);

    for (let column = 0; column < boundaries.length - 1; column += 1) {
      const x = boundaries[column];
      const right = boundaries[column + 1];
      const cellWidth = right - x;
      const cellHeight = bottom - top;
      if (cellWidth < 14 || cellHeight < 14) continue;
      cells.push({
        row: row.row,
        column,
        x,
        y: top,
        width: cellWidth,
        height: cellHeight,
        confidence: selected.confidence,
      });
    }
  }

  const verticalConfidence = rowConfidences.length
    ? Math.round(rowConfidences.reduce((sum, value) => sum + value, 0) / rowConfidences.length)
    : 0;

  return {
    rows,
    cells,
    horizontalConfidence: horizontal.confidence,
    verticalConfidence,
  };
}

export function makeEvenBoundaries(size: number, count: number): number[] {
  const safeCount = Math.max(1, Math.min(60, Math.round(count)));
  const lines = Array.from({ length: safeCount + 1 }, (_, index) =>
    Math.round((index / safeCount) * size),
  );
  lines[0] = 0;
  lines[lines.length - 1] = size;
  return lines;
}

export function countCells(lines: number[]): number {
  return Math.max(0, lines.length - 1);
}