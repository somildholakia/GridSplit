export type GridCoordinatePayload = {
  width: number;
  height: number;
  horizontalCuts: number[];
  verticalCutsByRow: number[][];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readDimension(payload: Record<string, unknown>, key: "width" | "height"): number {
  const value = payload[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`"${key}" must be a positive integer matching the original image size.`);
  }
  return value;
}

function readCuts(value: unknown, label: string, limit: number, dimension: number): number[] {
  if (!Array.isArray(value)) {
    throw new Error(`"${label}" must be an array of pixel coordinates.`);
  }
  if (value.length > limit) {
    throw new Error(`"${label}" contains too many cuts. A maximum of ${limit} cuts is supported.`);
  }

  const cuts = value.map((coordinate, index) => {
    if (typeof coordinate !== "number" || !Number.isFinite(coordinate)) {
      throw new Error(`"${label}" item ${index + 1} must be a numeric pixel coordinate.`);
    }
    const pixel = Math.round(coordinate);
    if (pixel <= 0 || pixel >= dimension) {
      throw new Error(`"${label}" item ${index + 1} (${pixel}) is outside the image. Use an interior pixel between 1 and ${dimension - 1}.`);
    }
    return pixel;
  });

  if (new Set(cuts).size !== cuts.length) {
    throw new Error(`"${label}" contains duplicate pixel coordinates. Remove duplicate lines and paste again.`);
  }

  return cuts.sort((left, right) => left - right);
}

/**
 * Parse and validate one complete bulk-grid payload. Coordinates are absolute
 * pixels measured from the original image's top-left corner.
 */
export function parseGridCoordinatePayload(
  rawText: string,
  expectedWidth: number,
  expectedHeight: number,
): GridCoordinatePayload {
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("Paste one complete JSON object containing width, height, horizontalCuts, and verticalCutsByRow.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new Error("The coordinate block is not valid JSON. Copy the complete block and paste it again.");
  }

  if (!isRecord(parsed)) {
    throw new Error("The coordinate block must be a JSON object.");
  }

  const width = readDimension(parsed, "width");
  const height = readDimension(parsed, "height");
  if (width !== expectedWidth || height !== expectedHeight) {
    throw new Error(
      `Image size mismatch: this image is ${expectedWidth} × ${expectedHeight}px, but the pasted coordinates are for ${width} × ${height}px. Generate coordinates for the original image dimensions currently shown in the terminal.`,
    );
  }

  const horizontalCuts = readCuts(parsed.horizontalCuts, "horizontalCuts", 59, height);
  const verticalValue = parsed.verticalCutsByRow;
  if (!Array.isArray(verticalValue)) {
    throw new Error('"verticalCutsByRow" must be an array with one entry for every image row.');
  }

  const expectedRows = horizontalCuts.length + 1;
  if (verticalValue.length !== expectedRows) {
    throw new Error(
      `Row count mismatch: ${horizontalCuts.length} horizontal cuts create ${expectedRows} rows, but verticalCutsByRow contains ${verticalValue.length}. Include one vertical coordinate array for every row, including rows with no cuts (use []).`,
    );
  }

  const verticalCutsByRow = verticalValue.map((cuts, row) =>
    readCuts(cuts, `verticalCutsByRow row ${row + 1}`, 59, width),
  );

  return { width, height, horizontalCuts, verticalCutsByRow };
}
