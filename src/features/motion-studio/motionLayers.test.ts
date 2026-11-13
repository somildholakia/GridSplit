import { describe, expect, it } from "vitest";
import { createPresetKeyframes, insertMotionKeyframe, resolveParticleSettings, sampleMotionKeyframes } from "./motionLayers";

describe("Motion Studio animation layers", () => {
  it("creates deterministic keyframe presets for zoom and pan", () => {
    expect(createPresetKeyframes("zoom-in", 1.3)).toEqual([
      { time: 0, scale: 1, panX: 0.5, panY: 0.5, rotation: 0 },
      { time: 1, scale: 1.3, panX: 0.5, panY: 0.5, rotation: 0 },
    ]);
    expect(createPresetKeyframes("pan-left", 1.2)[1].panX).toBe(0);
    expect(createPresetKeyframes("pan-right", 1.2)[1].panX).toBe(1);
  });

  it("interpolates transform values between authored keys", () => {
    const value = sampleMotionKeyframes([
      { time: 0, scale: 1, panX: 0, panY: 0.2, rotation: -10 },
      { time: 1, scale: 1.4, panX: 1, panY: 0.8, rotation: 10 },
    ], 0.5);
    expect(value.scale).toBeCloseTo(1.2);
    expect(value.panX).toBeCloseTo(0.5);
    expect(value.panY).toBeCloseTo(0.5);
    expect(value.rotation).toBeCloseTo(0);
  });

  it("clamps preview progress and keeps the last key at the end", () => {
    const keys = createPresetKeyframes("zoom-out", 1.4);
    expect(sampleMotionKeyframes(keys, -1).scale).toBe(1.4);
    expect(sampleMotionKeyframes(keys, 2).scale).toBe(1);
  });

  it("resolves image-specific particle overrides over global defaults", () => {
    expect(resolveParticleSettings(undefined, undefined, "snow", 40)).toEqual({
      preset: "snow", intensity: 40,
    });
    expect(resolveParticleSettings("embers", 75, "snow", 40)).toEqual({
      preset: "embers", intensity: 75,
    });
    expect(resolveParticleSettings("none", 140, "snow", 40)).toEqual({
      preset: "none", intensity: 100,
    });
  });

  it("inserts or replaces a keyframe at the same timestamp", () => {
    const original = createPresetKeyframes("ken-burns", 1.2);
    const next = insertMotionKeyframe(original, { time: 0.5, scale: 1.3, panX: 0.2, panY: 0.8, rotation: 5 });
    const replaced = insertMotionKeyframe(next, { time: 0.5, scale: 1.1, panX: 0.5, panY: 0.5, rotation: 0 });
    expect(replaced).toHaveLength(3);
    expect(replaced[1].scale).toBe(1.1);
  });
});
