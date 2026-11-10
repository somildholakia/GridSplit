import { describe, expect, it } from "vitest";
import type { ParsedScene } from "./scriptParser";
import { buildSynchronizationMetadata } from "./mediaTimeline";
import {
  buildProductionTimeline,
  moveTimelineClipToTrack,
  resizeTimelineClip,
  shiftTimelineClip,
  type ProductionTimeline,
} from "./productionTimeline";
import type { ImageSequenceAsset } from "./imageSequence";

const scene = (id: string, blockIds: string[] = ["b-" + id]): ParsedScene => ({
  id,
  title: "Scene " + id,
  chapter: "Chapter",
  sourceText: "Text",
  blocks: blockIds.map((blockId) => ({
    id: blockId,
    kind: "narration" as const,
    text: "Speech",
    sourceLine: 1,
  })),
});

const image = (id: string): ImageSequenceAsset => ({
  id, fileName: id + ".png", relativePath: id + ".png", mimeType: "image/png",
  sizeBytes: 100, sequenceNumber: 1, fingerprint: id,
});

function makeTimeline(): ProductionTimeline {
  const scenes = [scene("one")];
  const sync = buildSynchronizationMetadata([{
    id: "audio-1", sceneId: "one", blockId: "b-one", text: "Hello",
    sampleCount: 48000, sampleRate: 48000,
  }]);
  return buildProductionTimeline({
    scenes,
    images: [image("image-1"), image("image-2")],
    mappings: [{ sceneId: "one", imageIds: ["image-1", "image-2"] }],
    synchronization: sync,
  }).timeline;
}

describe("automatic production schedule", () => {
  it("supports one-to-many image mapping and splits measured scene duration exactly", () => {
    const timeline = makeTimeline();
    const video = timeline.tracks.find((track) => track.kind === "video");
    expect(video?.clips).toHaveLength(2);
    expect(video?.clips[0].duration).toEqual({ numerator: "1", denominator: "2" });
    expect(video?.clips[1].start).toEqual({ numerator: "1", denominator: "2" });
    expect(timeline.duration).toEqual({ numerator: "1", denominator: "1" });
  });

  it("allows one image to be mapped to multiple scenes and warns for missing assets/audio", () => {
    const scenes = [scene("one"), scene("two")];
    const sync = buildSynchronizationMetadata([]);
    const result = buildProductionTimeline({
      scenes,
      images: [image("shared")],
      mappings: [{ sceneId: "one", imageIds: ["shared"] }, { sceneId: "two", imageIds: ["shared", "missing"] }],
      synchronization: sync,
    });
    const clips = result.timeline.tracks[0].clips;
    expect(clips.filter((clip) => clip.assetId === "shared")).toHaveLength(2);
    expect(result.warnings.some((warning) => warning.includes("missing"))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("placeholder"))).toBe(true);
  });

  it("warns when no image is mapped to a scene", () => {
    const result = buildProductionTimeline({
      scenes: [scene("one")], images: [image("free")], mappings: [],
      synchronization: buildSynchronizationMetadata([]),
    });
    expect(result.warnings.some((warning) => warning.includes("no image is mapped"))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("not assigned"))).toBe(true);
  });
});

describe("timeline edit operations", () => {
  it("nudges, trims, and moves clips between compatible audio tracks", () => {
    const timeline = makeTimeline();
    const clip = timeline.tracks[1].clips[0];
    const shifted = shiftTimelineClip(timeline, clip.id, 250);
    expect(shifted.tracks[1].clips[0].start).toEqual({ numerator: "1", denominator: "4" });
    const resized = resizeTimelineClip(shifted, clip.id, 250);
    expect(resized.tracks[1].clips[0].duration).toEqual({ numerator: "3", denominator: "4" });
    const moved = moveTimelineClipToTrack(resized, clip.id, "track-music-sfx");
    expect(moved.tracks[1].clips).toHaveLength(0);
    expect(moved.tracks[2].clips[0].trackId).toBe("track-music-sfx");
  });

  it("does not shift clips before zero or resize them to zero", () => {
    const timeline = makeTimeline();
    const clipId = timeline.tracks[0].clips[0].id;
    const shifted = shiftTimelineClip(timeline, clipId, -250);
    expect(shifted.tracks[0].clips[0].start).toEqual({ numerator: "0", denominator: "1" });
    const resized = resizeTimelineClip(timeline, clipId, -1000);
    expect(resized.tracks[0].clips[0].duration).toEqual({ numerator: "1", denominator: "2" });
  });
});
