import { describe, expect, it } from "vitest";
import {
  buildImageTimelineFromDurations,
  getTimelinePosition,
  normalizeMediaFilename,
  parseMotionSyncManifest,
  resolveMotionSyncManifest,
} from "./syncManifest";

const sample = {
  format: "gridsplit-motion-sync",
  version: 1,
  audio: { fileName: "narration.wav", durationSeconds: 20 },
  images: [
    { fileName: "frames/frame-001.png", startSeconds: 0, endSeconds: 7, matchedText: "Opening" },
    { fileName: "frames/frame-002.png", startSeconds: 7, endSeconds: 20, matchedText: "Ending" },
  ],
};

describe("Motion Studio sync manifest", () => {
  it("normalizes paths and case when matching media names", () => {
    expect(normalizeMediaFilename("frames\\FRAME-001.PNG")).toBe("frame-001.png");
  });

  it("validates and resolves per-image durations", () => {
    const manifest = parseMotionSyncManifest(sample);
    expect(resolveMotionSyncManifest(manifest, ["frame-001.png", "frame-002.png"], "narration.wav", 20))
      .toEqual([7, 13]);
  });

  it("rejects an audio mismatch and missing images", () => {
    const manifest = parseMotionSyncManifest(sample);
    expect(() => resolveMotionSyncManifest(manifest, ["frame-001.png", "frame-002.png"], "other.wav", 20))
      .toThrow(/different audio/);
    expect(() => resolveMotionSyncManifest(manifest, ["frame-001.png"], "narration.wav", 20))
      .toThrow(/Image count mismatch/);
  });

  it("rejects discontinuous timelines", () => {
    const invalid = {
      ...sample,
      images: [
        sample.images[0],
        { ...sample.images[1], startSeconds: 8 },
      ],
    };
    const manifest = parseMotionSyncManifest(invalid);
    expect(() => resolveMotionSyncManifest(manifest, ["frame-001.png", "frame-002.png"], "narration.wav", 20))
      .toThrow(/gap or overlap/);
  });

  it("builds contiguous clip records that exactly cover audio", () => {
    const clips = buildImageTimelineFromDurations(["a", "b"], 20, "scene", [7, 13], () => "id");
    expect(clips.map((clip) => [clip.startSeconds, clip.durationSeconds, clip.order]))
      .toEqual([[0, 7, 0], [7, 13, 1]]);
  });

  it("locates the active clip and its local progress", () => {
    expect(getTimelinePosition(9, [7, 13])).toEqual({ index: 1, progress: 2 / 13 });
    expect(getTimelinePosition(20, [7, 13])?.index).toBe(1);
    expect(getTimelinePosition(0, [])).toBeNull();
  });
});
