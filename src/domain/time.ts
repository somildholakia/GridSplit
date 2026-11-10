/**
 * Exact rational media time.
 *
 * Serialized numerator/denominator strings remain JSON-safe and preserve exact
 * sample/frame-derived values. Use rationalTimeToSeconds only at display or
 * APIs that explicitly require floating-point seconds.
 */
export type RationalTime = {
  numerator: string;
  denominator: string;
};

export type RationalFrameRate = {
  num: number;
  den: number;
};

function toBigInt(value: bigint | number | string, label: string): bigint {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new RangeError(label + " must be a safe integer.");
  }
  try {
    return BigInt(value);
  } catch {
    throw new TypeError(label + " must be an integer.");
  }
}

function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a === 0n ? 1n : a;
}

export function normalizeRationalTime(
  numerator: bigint | number | string,
  denominator: bigint | number | string,
): RationalTime {
  let top = toBigInt(numerator, "Numerator");
  let bottom = toBigInt(denominator, "Denominator");
  if (bottom === 0n) throw new RangeError("Denominator cannot be zero.");
  if (bottom < 0n) {
    top = -top;
    bottom = -bottom;
  }
  const divisor = gcd(top, bottom);
  return {
    numerator: (top / divisor).toString(),
    denominator: (bottom / divisor).toString(),
  };
}

export function rationalTimeFromSamples(
  sampleCount: number,
  sampleRate: number,
): RationalTime {
  if (!Number.isSafeInteger(sampleCount) || sampleCount < 0) {
    throw new RangeError("Sample count must be a non-negative safe integer.");
  }
  if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0) {
    throw new RangeError("Sample rate must be a positive safe integer.");
  }
  return normalizeRationalTime(sampleCount, sampleRate);
}

export function rationalTimeFromFrames(
  frameCount: number,
  fps: RationalFrameRate,
): RationalTime {
  if (!Number.isSafeInteger(frameCount) || frameCount < 0) {
    throw new RangeError("Frame count must be a non-negative safe integer.");
  }
  if (!Number.isSafeInteger(fps.num) || fps.num <= 0 ||
      !Number.isSafeInteger(fps.den) || fps.den <= 0) {
    throw new RangeError("FPS numerator and denominator must be positive safe integers.");
  }
  return normalizeRationalTime(
    BigInt(frameCount) * BigInt(fps.den),
    fps.num,
  );
}

export function addRationalTimes(left: RationalTime, right: RationalTime): RationalTime {
  const leftNumerator = BigInt(left.numerator);
  const leftDenominator = BigInt(left.denominator);
  const rightNumerator = BigInt(right.numerator);
  const rightDenominator = BigInt(right.denominator);
  if (leftDenominator <= 0n || rightDenominator <= 0n) {
    throw new RangeError("Rational time denominators must be positive.");
  }
  return normalizeRationalTime(
    leftNumerator * rightDenominator + rightNumerator * leftDenominator,
    leftDenominator * rightDenominator,
  );
}

export function compareRationalTimes(left: RationalTime, right: RationalTime): number {
  const leftDenominator = BigInt(left.denominator);
  const rightDenominator = BigInt(right.denominator);
  if (leftDenominator <= 0n || rightDenominator <= 0n) {
    throw new RangeError("Rational time denominators must be positive.");
  }
  const difference =
    BigInt(left.numerator) * rightDenominator -
    BigInt(right.numerator) * leftDenominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

/** Convert only at a UI/codec boundary that explicitly consumes seconds. */
export function rationalTimeToSeconds(value: RationalTime): number {
  const denominator = BigInt(value.denominator);
  if (denominator <= 0n) throw new RangeError("Rational time denominator must be positive.");
  return Number(BigInt(value.numerator)) / Number(denominator);
}
