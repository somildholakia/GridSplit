import { describe, expect, it } from "vitest";
import {
  addRationalTimes,
  compareRationalTimes,
  normalizeRationalTime,
  rationalTimeFromFrames,
  rationalTimeFromSamples,
  rationalTimeToSeconds,
} from "./time";

describe("rational media time", () => {
  it("normalizes fractions and keeps denominators positive", () => {
    expect(normalizeRationalTime(6, 8)).toEqual({ numerator: "3", denominator: "4" });
    expect(normalizeRationalTime(1, -2)).toEqual({ numerator: "-1", denominator: "2" });
  });

  it("derives exact duration from decoded audio samples", () => {
    expect(rationalTimeFromSamples(44_100, 22_050)).toEqual({
      numerator: "2",
      denominator: "1",
    });
    expect(rationalTimeFromSamples(48_000, 48_000)).toEqual({
      numerator: "1",
      denominator: "1",
    });
  });

  it("derives exact duration from rational frame rates", () => {
    expect(rationalTimeFromFrames(75, { num: 25, den: 1 })).toEqual({
      numerator: "3",
      denominator: "1",
    });
    expect(rationalTimeFromFrames(30, { num: 30_000, den: 1_001 })).toEqual({
      numerator: "1001",
      denominator: "1000",
    });
  });

  it("adds and compares different rational timebases without float drift", () => {
    const oneThird = normalizeRationalTime(1, 3);
    const oneSixth = normalizeRationalTime(1, 6);
    const oneHalf = addRationalTimes(oneThird, oneSixth);

    expect(oneHalf).toEqual({ numerator: "1", denominator: "2" });
    expect(compareRationalTimes(oneHalf, normalizeRationalTime(2, 4))).toBe(0);
    expect(compareRationalTimes(oneThird, oneHalf)).toBe(-1);
    expect(compareRationalTimes(oneHalf, oneThird)).toBe(1);
  });

  it("converts to seconds only at the presentation boundary", () => {
    expect(rationalTimeToSeconds(rationalTimeFromSamples(22_050, 22_050))).toBe(1);
  });

  it("rejects zero denominators, unsafe integers and invalid media rates", () => {
    expect(() => normalizeRationalTime(1, 0)).toThrow(RangeError);
    expect(() => normalizeRationalTime(Number.MAX_SAFE_INTEGER + 1, 1)).toThrow(RangeError);
    expect(() => rationalTimeFromSamples(-1, 48_000)).toThrow(RangeError);
    expect(() => rationalTimeFromSamples(100, 0)).toThrow(RangeError);
    expect(() => rationalTimeFromFrames(24, { num: 0, den: 1 })).toThrow(RangeError);
  });
});
