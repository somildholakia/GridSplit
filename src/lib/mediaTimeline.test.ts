import { describe, expect, it } from "vitest";
import { buildSynchronizationMetadata, toSrt, toVtt } from "./mediaTimeline";

const segments = [
  { id: "a", sceneId: "scene-1", blockId: "block-1", text: "Hello there.", speaker: "Maya", sampleCount: 24_000, sampleRate: 24_000 },
  { id: "b", sceneId: "scene-1", blockId: "block-2", text: "Welcome back.", sampleCount: 48_000, sampleRate: 48_000 },
  { id: "c", sceneId: "scene-2", blockId: "block-3", text: "The end.", sampleCount: 12_000, sampleRate: 24_000 },
];

describe("sample-accurate media timeline", () => {
  it("measures and accumulates exact durations across sample rates", () => {
    const result = buildSynchronizationMetadata(segments);
    expect(result.segments.map((item) => [item.start, item.end])).toEqual([
      [{ numerator: "0", denominator: "1" }, { numerator: "1", denominator: "1" }],
      [{ numerator: "1", denominator: "1" }, { numerator: "2", denominator: "1" }],
      [{ numerator: "2", denominator: "1" }, { numerator: "5", denominator: "2" }],
    ]);
    expect(result.totalDuration).toEqual({ numerator: "5", denominator: "2" });
    expect(result.totalDurationSeconds).toBe(2.5);
    expect(result.scenes.map((scene) => scene.segmentIds)).toEqual([["a", "b"], ["c"]]);
  });

  it("exports deterministic segment-level SRT and VTT cues", () => {
    const result = buildSynchronizationMetadata(segments);
    expect(toSrt(result)).toContain("00:00:00,000 --> 00:00:01,000\nMaya: Hello there.");
    expect(toVtt(result)).toContain("WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nMaya: Hello there.");
  });

  it("rejects invalid sample metadata and duplicate IDs", () => {
    expect(() => buildSynchronizationMetadata([{ ...segments[0], sampleRate: 0 }])).toThrow(/positive sample count/);
    expect(() => buildSynchronizationMetadata([segments[0], segments[0]])).toThrow(/unique/);
  });

  it("does not invent a cue for empty text", () => {
    const result = buildSynchronizationMetadata([{ ...segments[0], text: "  " }]);
    expect(toSrt(result)).toBe("");
    expect(toVtt(result)).toBe("WEBVTT\n\n");
  });
});
