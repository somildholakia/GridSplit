import { describe, expect, it } from "vitest";
import { getMotionDissolveFilterParameters } from "./motionCanvas";

describe("Motion Studio dissolve mask", () => {
  it("places the reveal threshold at the requested transition progress", () => {
    for (const progress of [0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99]) {
      const { slope, intercept } = getMotionDissolveFilterParameters(progress);
      expect(slope * progress + intercept).toBeCloseTo(0.5, 8);
      expect(slope * Math.max(0, progress - 0.01) + intercept).toBeGreaterThan(0.5);
      expect(slope * Math.min(1, progress + 0.01) + intercept).toBeLessThan(0.5);
    }
  });

  it("keeps endpoint and invalid progress values numerically safe", () => {
    for (const progress of [0, 1, -1, 2, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = getMotionDissolveFilterParameters(progress);
      expect(Number.isFinite(result.slope)).toBe(true);
      expect(Number.isFinite(result.intercept)).toBe(true);
      expect(result.slope).toBeLessThan(0);
      expect(result.intercept).toBeGreaterThan(0);
    }
  });
});
