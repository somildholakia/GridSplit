import { describe, expect, it } from "vitest";
import {
  analyseSequence,
  buildTimeline,
  extractSequenceNumber,
  imageClipAtTime,
  moveTimelineClip,
  normalizeMappings,
  orderMappingsByAssetOrder,
  sortSequence,
  timelineDurationSeconds,
  resizeImageClipKeepingSceneDuration,
  setAllImageClipDurations,
  setAllImageClipDurationsAcrossTimeline,
  resizeImageClipKeepingTimelineDuration,
  buildEvenTimeline,
  splitImageClipAtTime,
  type SequenceAsset,
} from "./productionModel";

const asset = (
  id: string,
  sequenceNumber: number | null,
  fingerprint = id,
  order = 0,
): SequenceAsset => ({
  id,
  name: id + ".png",
  relativePath: id + ".png",
  mimeType: "image/png",
  bytes: 128,
  sequenceNumber,
  order,
  width: 640,
  height: 360,
  fingerprint,
});

describe("image sequence management", () => {
  it("extracts safe frame numbers from names and nested Windows or POSIX paths", () => {
    expect(extractSequenceNumber("frames/frame-0007.png")).toBe(7);
    expect(extractSequenceNumber("frames\\frame-0012.webp")).toBe(12);
    expect(extractSequenceNumber("cover.png")).toBeNull();
    expect(extractSequenceNumber("frame-999999999999999999.png")).toBeNull();
  });

  it("natural-sorts relative paths without mutating the source array", () => {
    const files = [
      { name: "frame10.png", relativePath: "scene/frame10.png" },
      { name: "frame2.png", relativePath: "scene/frame2.png" },
    ];
    expect(sortSequence(files).map((item) => item.name)).toEqual(["frame2.png", "frame10.png"]);
    expect(files[0].name).toBe("frame10.png");
  });

  it("reports gaps, repeated frame numbers, content duplicates, and unnumbered files", () => {
    const issues = analyseSequence([
      asset("frame-1", 1, "hash-a", 0),
      asset("frame-3-a", 3, "hash-b", 1),
      asset("frame-3-b", 3, "hash-b", 2),
      asset("cover", null, "hash-cover", 3),
    ]);
    expect(issues.some((issue) => issue.kind === "gap" && issue.message.includes("2"))).toBe(true);
    expect(issues.some((issue) => issue.kind === "duplicate" && issue.message.includes("Frame 3"))).toBe(true);
    expect(issues.some((issue) => issue.kind === "duplicate" && issue.assetIds.includes("frame-3-b"))).toBe(true);
    expect(issues.some((issue) => issue.kind === "unnumbered" && issue.assetIds[0] === "cover")).toBe(true);
  });
});

describe("many-to-many scene mapping", () => {
  it("keeps mapped image order aligned with manual sequence order", () => {
    const mappings = [{ sceneId: "scene-a", imageIds: ["frame-3", "frame-1", "frame-2"] }];
    const assets = [
      { id: "frame-1", order: 0 },
      { id: "frame-2", order: 1 },
      { id: "frame-3", order: 2 },
    ];
    expect(orderMappingsByAssetOrder(mappings, assets)[0].imageIds)
      .toEqual(["frame-1", "frame-2", "frame-3"]);
    expect(mappings[0].imageIds).toEqual(["frame-3", "frame-1", "frame-2"]);
  });

  it("merges repeated scene mappings and removes stale or duplicate references", () => {
    expect(normalizeMappings(
      [
        { sceneId: "scene-a", imageIds: ["one", "one", "missing"] },
        { sceneId: "scene-a", imageIds: ["two"] },
        { sceneId: "deleted-scene", imageIds: ["one"] },
      ],
      ["scene-a"],
      ["one", "two"],
    )).toEqual([{ sceneId: "scene-a", imageIds: ["one", "two"] }]);
  });
});

describe("automatic schedule and timeline editing", () => {
  it("splits each scene over its mapped images and continues the next scene", () => {
    let id = 0;
    const clips = buildTimeline([
      { sceneId: "one", durationSeconds: 4, imageIds: ["a", "b"] },
      { sceneId: "two", durationSeconds: 2, imageIds: ["c"] },
    ], () => "clip-" + (++id));
    const images = clips.filter((clip) => clip.track === "images");
    expect(images.map((clip) => [clip.startSeconds, clip.durationSeconds])).toEqual([
      [0, 2], [2, 2], [4, 2],
    ]);
    expect(timelineDurationSeconds(clips)).toBe(6);
    expect(imageClipAtTime(clips, 2)?.assetId).toBe("b");
    expect(imageClipAtTime(clips, 4)?.assetId).toBe("c");
    expect(imageClipAtTime(clips, 6)).toBeUndefined();
  });

  it("ignores invalid durations and duplicate image references", () => {
    const clips = buildTimeline([
      { sceneId: "bad", durationSeconds: Number.NaN, imageIds: ["a"] },
      { sceneId: "good", durationSeconds: 2, imageIds: ["a", "a"] },
    ], () => "fixed");
    expect(clips).toHaveLength(2);
    expect(clips[0].durationSeconds).toBe(2);
    expect(clips[0].assetId).toBe("a");
  });

  it("reorders clips within their own track without changing clip timing", () => {
    let nextId = 0;
    const clips = buildTimeline([
      { sceneId: "one", durationSeconds: 2, imageIds: ["a"] },
      { sceneId: "two", durationSeconds: 2, imageIds: ["b"] },
    ], () => "clip-" + (++nextId));
    const imageClips = clips.filter((clip) => clip.track === "images");
    const moved = moveTimelineClip(clips, imageClips[1].id, -1);
    expect(moved.filter((clip) => clip.track === "images").sort((a, b) => a.order - b.order).map((clip) => clip.assetId))
      .toEqual(["b", "a"]);
    expect(moved.find((clip) => clip.id === imageClips[1].id)?.startSeconds).toBe(2);
  });

  it("resizes one image while redistributing remaining scene time and preserving audio coverage", () => {
    let id = 0;
    const clips = buildTimeline([
      { sceneId: "one", durationSeconds: 42, imageIds: ["a", "b", "c"] },
    ], () => "clip-" + (++id));
    const target = clips.find((clip) => clip.track === "images" && clip.assetId === "b")!;
    const resized = resizeImageClipKeepingSceneDuration(clips, target.id, 10.25);
    const images = resized.filter((clip) => clip.track === "images").sort((a, b) => a.order - b.order);
    expect(images.find((clip) => clip.id === target.id)?.durationSeconds).toBe(10.25);
    expect(images.reduce((total, clip) => total + clip.durationSeconds, 0)).toBeCloseTo(42, 8);
    expect(images[0].startSeconds).toBe(0);
    expect(images[1].startSeconds).toBeCloseTo(images[0].durationSeconds, 8);
    expect(images[2].startSeconds + images[2].durationSeconds).toBeCloseTo(42, 8);
  });

  it("applies one two-decimal hold duration to every image and lets the last image fill the audio tail", () => {
    let id = 0;
    const clips = buildTimeline([
      { sceneId: "one", durationSeconds: 30, imageIds: ["a", "b", "c"] },
      { sceneId: "two", durationSeconds: 12, imageIds: ["d", "e"] },
    ], () => "clip-" + (++id));
    const updated = setAllImageClipDurations(clips, 4.25)!;
    const one = updated.filter((clip) => clip.track === "images" && clip.sceneId === "one").sort((a, b) => a.order - b.order);
    const two = updated.filter((clip) => clip.track === "images" && clip.sceneId === "two").sort((a, b) => a.order - b.order);
    expect(one.map((clip) => clip.durationSeconds)).toEqual([4.25, 4.25, 21.5]);
    expect(two.map((clip) => clip.durationSeconds)).toEqual([4.25, 7.75]);
    expect(one[2].startSeconds + one[2].durationSeconds).toBe(30);
    expect(two[1].startSeconds + two[1].durationSeconds).toBe(42);
  });

  it("rejects bulk durations that cannot fit while keeping each scene covered", () => {
    let id = 0;
    const clips = buildTimeline([
      { sceneId: "one", durationSeconds: 5, imageIds: ["a", "b", "c"] },
    ], () => "clip-" + (++id));
    expect(setAllImageClipDurations(clips, 2.5)).toBeNull();
  });

  it("splits an image clip at the playhead and preserves the original end time", () => {
    let id = 0;
    const clips = buildTimeline([
      { sceneId: "one", durationSeconds: 10, imageIds: ["a", "b"] },
    ], () => "clip-" + (++id));
    const target = clips.find((clip) => clip.track === "images")!;
    const split = splitImageClipAtTime(clips, target.id, 2.75, () => "split-1");
    const parts = split.filter((clip) => clip.assetId === target.assetId).sort((a, b) => a.startSeconds - b.startSeconds);
    expect(parts).toHaveLength(2);
    expect(parts[0].durationSeconds).toBe(2.75);
    expect(parts[1].startSeconds).toBe(2.75);
    expect(parts[1].durationSeconds).toBeCloseTo(2.25, 8);
  });

});



describe("even image distribution across the complete audio runtime", () => {
  it("gives 20 images exactly 30 seconds each across a 10-minute audio timeline", () => {
    let nextId = 0;
    const clips = buildEvenTimeline([
      { sceneId: "scene-a", durationSeconds: 240 },
      { sceneId: "scene-b", durationSeconds: 360 },
    ], Array.from({ length: 20 }, (_, index) => "image-" + (index + 1)), () => "even-" + (++nextId));

    const images = clips.filter((clip) => clip.track === "images").sort((a, b) => a.order - b.order);
    const audio = clips.filter((clip) => clip.track === "audio").sort((a, b) => a.order - b.order);
    expect(images).toHaveLength(20);
    expect(images.every((clip) => Math.abs(clip.durationSeconds - 30) < 1e-9)).toBe(true);
    expect(images[0].startSeconds).toBe(0);
    expect(images[19].startSeconds + images[19].durationSeconds).toBe(600);
    expect(images[8].sceneId).toBe("scene-b");
    expect(audio.reduce((sum, clip) => sum + clip.durationSeconds, 0)).toBe(600);
    expect(timelineDurationSeconds(clips)).toBe(600);
  });

  it("ripple-resizes one image but keeps the full audio duration continuously covered", () => {
    let nextId = 0;
    const clips = buildEvenTimeline([
      { sceneId: "scene-a", durationSeconds: 240 },
      { sceneId: "scene-b", durationSeconds: 360 },
    ], Array.from({ length: 20 }, (_, index) => "image-" + (index + 1)), () => "even-" + (++nextId));
    const target = clips.find((clip) => clip.track === "images" && clip.order === 5)!;
    const resized = resizeImageClipKeepingTimelineDuration(clips, target.id, 45.25);
    const images = resized.filter((clip) => clip.track === "images").sort((a, b) => a.startSeconds - b.startSeconds);
    expect(images.find((clip) => clip.id === target.id)?.durationSeconds).toBe(45.25);
    expect(images[0].startSeconds).toBe(0);
    images.slice(1).forEach((clip, index) => {
      expect(clip.startSeconds).toBeCloseTo(images[index].startSeconds + images[index].durationSeconds, 8);
    });
    expect(images[images.length - 1].startSeconds + images[images.length - 1].durationSeconds).toBeCloseTo(600, 8);
  });

  it("applies a shared hold duration globally and lets the final image fill the audio tail", () => {
    let nextId = 0;
    const clips = buildEvenTimeline([
      { sceneId: "scene-a", durationSeconds: 300 },
      { sceneId: "scene-b", durationSeconds: 300 },
    ], Array.from({ length: 20 }, (_, index) => "image-" + (index + 1)), () => "even-" + (++nextId));
    const updated = setAllImageClipDurationsAcrossTimeline(clips, 30)!;
    const images = updated.filter((clip) => clip.track === "images").sort((a, b) => a.order - b.order);
    expect(images.every((clip) => clip.durationSeconds === 30)).toBe(true);
    expect(images[images.length - 1].startSeconds + images[images.length - 1].durationSeconds).toBe(600);
  });

  it("rejects a global hold duration that leaves less than 0.01 seconds for the final image", () => {
    let nextId = 0;
    const clips = buildEvenTimeline([
      { sceneId: "scene-a", durationSeconds: 10 },
    ], ["a", "b", "c"], () => "even-" + (++nextId));
    expect(setAllImageClipDurationsAcrossTimeline(clips, 5)).toBeNull();
  });

  it("deduplicates repeated image IDs when making a single continuous sequence", () => {
    let nextId = 0;
    const clips = buildEvenTimeline(
      [{ sceneId: "scene-a", durationSeconds: 12 }],
      ["same", "same", "second"],
      () => "even-" + (++nextId),
    );
    expect(clips.filter((clip) => clip.track === "images")).toHaveLength(2);
    expect(clips.filter((clip) => clip.track === "images").reduce((sum, clip) => sum + clip.durationSeconds, 0)).toBe(12);
  });
});
