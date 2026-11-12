import { describe, expect, it } from "vitest";
import { buildEvenImageTimeline } from "./motionTiming";

describe("buildEvenImageTimeline", () => {
  it("distributes a ten-minute soundtrack across twenty images with equal holds", () => {
    const ids = Array.from({ length: 20 }, (_, index) => "image-" + (index + 1));
    const clips = buildEvenImageTimeline(ids, 600, "scene-1", () => "clip-id");

    expect(clips).toHaveLength(20);
    expect(clips.every((clip) => clip.durationSeconds === 30)).toBe(true);
    expect(clips[0].startSeconds).toBe(0);
    expect(clips[19].startSeconds + clips[19].durationSeconds).toBe(600);
    expect(clips.every((clip, index) => clip.assetId === ids[index] && clip.order === index)).toBe(true);
  });

  it("uses the final image to absorb floating-point remainder", () => {
    const clips = buildEvenImageTimeline(["a", "b", "c"], 7, "scene", (() => {
      let id = 0;
      return () => "clip-" + ++id;
    })());

    expect(clips[0].durationSeconds).toBe(7 / 3);
    expect(clips[1].durationSeconds).toBe(7 / 3);
    expect(clips[2].startSeconds + clips[2].durationSeconds).toBe(7);
    expect(clips[1].startSeconds + clips[1].durationSeconds).toBe(clips[2].startSeconds);
  });

  it("rejects empty images and invalid durations", () => {
    expect(() => buildEvenImageTimeline([], 10, "scene")).toThrow(/at least one image/i);
    expect(() => buildEvenImageTimeline(["a"], 0, "scene")).toThrow(/duration/i);
    expect(() => buildEvenImageTimeline(["a"], Number.NaN, "scene")).toThrow(/duration/i);
    expect(() => buildEvenImageTimeline(["a"], 10, "")).toThrow(/scene ID/i);
  });
});
