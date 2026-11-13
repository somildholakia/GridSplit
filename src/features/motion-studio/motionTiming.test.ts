import { describe, expect, it } from "vitest";
import {
  buildEvenImageTimeline,
  buildMotionPreviewSchedule,
  getMotionPreviewFrameState,
  moveSequenceItem,
} from "./motionTiming";

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

describe("moveSequenceItem", () => {
  it("moves clips without mutating the original sequence", () => {
    const source = ["image-1", "image-2", "image-3"];
    expect(moveSequenceItem(source, 0, 2)).toEqual(["image-2", "image-3", "image-1"]);
    expect(source).toEqual(["image-1", "image-2", "image-3"]);
  });

  it("keeps the original sequence for invalid or unchanged positions", () => {
    const source = ["image-1", "image-2"];
    expect(moveSequenceItem(source, -1, 1)).toBe(source);
    expect(moveSequenceItem(source, 0, 0)).toBe(source);
    expect(moveSequenceItem(source, 0, 9)).toBe(source);
  });
});

describe("Motion Studio continuous preview timing", () => {
  it("matches FFmpeg dissolve offsets while preserving total duration", () => {
    const schedule = buildMotionPreviewSchedule([10, 10], "dissolve", 0.6);
    expect(schedule[1].startSeconds).toBeCloseTo(9.4);
    const state = getMotionPreviewFrameState(9.7, schedule);
    expect(state?.kind).toBe("transition");
    if (state?.kind === "transition") {
      expect(state.outgoingIndex).toBe(0);
      expect(state.incomingIndex).toBe(1);
      expect(state.progress).toBeCloseTo(0.5);
    }
  });

  it("uses exact cut boundaries without overlap", () => {
    const schedule = buildMotionPreviewSchedule([4, 6], "cut", 0.6);
    expect(schedule[1].startSeconds).toBe(4);
    expect(schedule[1].transitionDurationSeconds).toBe(0);
    expect(getMotionPreviewFrameState(3.999, schedule)).toMatchObject({ kind: "clip", currentIndex: 0 });
    expect(getMotionPreviewFrameState(4, schedule)).toMatchObject({ kind: "clip", currentIndex: 1, progress: 0 });
  });

  it("matches sequential xfade offsets and clamps the final padded frame", () => {
    const schedule = buildMotionPreviewSchedule([10, 10, 10], "fade", 0.6);
    expect(schedule[0].startSeconds).toBe(0);
    expect(schedule[1].startSeconds).toBeCloseTo(9.4);
    expect(schedule[2].startSeconds).toBeCloseTo(18.8);
    expect(getMotionPreviewFrameState(29.9, schedule)).toMatchObject({ kind: "clip", currentIndex: 2, progress: 1 });
  });

  it("limits a transition to half of incoming and accumulated durations", () => {
    const schedule = buildMotionPreviewSchedule([0.4, 0.3], "wipe-left", 2);
    expect(schedule[1].transitionDurationSeconds).toBeCloseTo(0.15);
    expect(schedule[1].startSeconds).toBeCloseTo(0.25);
  });

  it("rejects invalid clip durations", () => {
    expect(() => buildMotionPreviewSchedule([2, 0], "cut", 0)).toThrow(/duration/i);
  });
});
