import { describe, expect, it } from "vitest";
import {
  analyseSequence,
  buildTimeline,
  extractSequenceNumber,
  imageClipAtTime,
  moveTimelineClip,
  normalizeMappings,
  sortSequence,
  timelineDurationSeconds,
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
    const clips = buildTimeline([
      { sceneId: "one", durationSeconds: 2, imageIds: ["a"] },
      { sceneId: "two", durationSeconds: 2, imageIds: ["b"] },
    ], () => "clip-" + Math.random());
    const imageClips = clips.filter((clip) => clip.track === "images");
    const moved = moveTimelineClip(clips, imageClips[1].id, -1);
    expect(moved.filter((clip) => clip.track === "images").sort((a, b) => a.order - b.order).map((clip) => clip.assetId))
      .toEqual(["b", "a"]);
    expect(moved.find((clip) => clip.id === imageClips[1].id)?.startSeconds).toBe(2);
  });
});
