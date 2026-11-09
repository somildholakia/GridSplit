export type GridLines = {
  vertical: number[];
  horizontal: number[];
  verticalConfidence: number;
  horizontalConfidence: number;
};

type Peak = { position: number; score: number };

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
): Float32Array {
  const axisLength = vertical ? width : height;
  const crossLength = vertical ? height : width;
  const scores = new Float32Array(axisLength);
  const sampleStep = Math.max(1, Math.floor(crossLength / 700));

  for (let axis = 2; axis < axisLength - 2; axis += 1) {
    let total = 0;
    let darkBorderHits = 0;
    let samples = 0;

    for (let cross = 1; cross < crossLength - 1; cross += sampleStep) {
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

function findPeaks(profile: Float32Array, axisLength: number): Peak[] {
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

function pruneCrowdedLines(lines: number[], scores: Float32Array, axisLength: number): number[] {
  if (lines.length < 3) return lines;
  const targetMax = Math.min(34, Math.max(3, Math.floor(axisLength / 24)));
  if (lines.length <= targetMax) return lines;

  const ranked = lines
    .map((position) => ({ position, score: scores[position] ?? 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, targetMax)
    .map((item) => item.position);

  return ranked.sort((a, b) => a - b);
}

function detectAxis(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  vertical: boolean,
): { lines: number[]; confidence: number } {
  const axisLength = vertical ? width : height;
  const profile = axisProfile(data, width, height, vertical);
  const peaks = findPeaks(profile, axisLength);
  const interior = peaks.map((peak) => peak.position);
  const pruned = pruneCrowdedLines(interior, profile, axisLength);
  const lines = [0, ...pruned.filter((line) => line > 3 && line < axisLength - 3), axisLength];
  const meanStrength = pruned.length
    ? pruned.reduce((sum, position) => sum + profile[position], 0) / pruned.length
    : 0;
  const confidence = Math.max(0, Math.min(100, Math.round((meanStrength / 72) * 100)));
  return { lines: Array.from(new Set(lines)).sort((a, b) => a - b), confidence };
}

export function detectGrid(imageData: ImageData): GridLines {
  const vertical = detectAxis(imageData.data, imageData.width, imageData.height, true);
  const horizontal = detectAxis(imageData.data, imageData.width, imageData.height, false);

  return {
    vertical: vertical.lines,
    horizontal: horizontal.lines,
    verticalConfidence: vertical.confidence,
    horizontalConfidence: horizontal.confidence,
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