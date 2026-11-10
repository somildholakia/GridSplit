import { describe, expect, it } from "vitest";
import {
  audibleTrackIds,
  buildGainAutomation,
  createDefaultAudioMixTracks,
  normalizeAudioMixTracks,
  validateRenderProfile,
  validateRenderTimeline,
  type RenderProfile,
} from "./production";

describe("audio mix track contracts", () => {
  it("creates four independently addressable local mix tracks", () => {
    let id = 0;
    const tracks = createDefaultAudioMixTracks(() => "track-" + (++id));
    expect(tracks.map((track) => track.kind)).toEqual(["narration", "dialogue", "music", "sfx"]);
    expect(new Set(tracks.map((track) => track.id)).size).toBe(4);
    expect(tracks.find((track) => track.kind === "music")?.volume).toBe(0.35);
  });

  it("normalizes persisted settings and clamps hostile values", () => {
    const tracks = normalizeAudioMixTracks([
      { id: "music-1", kind: "music", name: "Background", volume: 9, muted: false, solo: true, fadeInSeconds: -2, fadeOutSeconds: 99 },
      { id: "unknown", kind: "not-a-track", volume: 1 },
    ], () => "generated");
    const music = tracks.find((track) => track.kind === "music")!;
    expect(music.volume).toBe(2);
    expect(music.fadeInSeconds).toBe(0);
    expect(music.fadeOutSeconds).toBe(30);
    expect(tracks).toHaveLength(4);
    expect(tracks.some((track) => track.id === "unknown")).toBe(false);
  });

  it("applies solo precedence while respecting muted tracks", () => {
    const tracks = createDefaultAudioMixTracks(() => crypto.randomUUID());
    const changed = tracks.map((track) => ({
      ...track,
      solo: track.kind === "dialogue" || track.kind === "music",
      muted: track.kind === "music",
    }));
    const active = audibleTrackIds(changed);
    expect(active).toEqual(new Set([changed.find((track) => track.kind === "dialogue")!.id]));
  });

  it("builds bounded fade envelopes for a track", () => {
    expect(buildGainAutomation(8, 0.5, 2, 3)).toEqual([
      { timeSeconds: 0, gain: 0 },
      { timeSeconds: 2, gain: 0.5 },
      { timeSeconds: 5, gain: 0.5 },
      { timeSeconds: 8, gain: 0 },
    ]);
    expect(buildGainAutomation(1, 1, 4, 4)).toEqual([
      { timeSeconds: 0, gain: 0 },
      { timeSeconds: 0.5, gain: 1 },
      { timeSeconds: 1, gain: 0 },
    ]);
  });
});

describe("render profile and preflight validation", () => {
  const profile: RenderProfile = { width: 1920, height: 1080, fps: 30, aspectRatio: "16:9", quality: "balanced" };

  it("rejects incompatible dimensions and aspect ratios", () => {
    expect(validateRenderProfile({ ...profile, width: 1919 })).toContainEqual(expect.objectContaining({ code: "odd-dimensions" }));
    expect(validateRenderProfile({ ...profile, width: 1080, height: 1920 })).toContainEqual(expect.objectContaining({ code: "aspect-mismatch" }));
  });

  it("blocks missing image sources but reports editable timeline gaps as warnings", () => {
    const issues = validateRenderTimeline({
      imageClips: [
        { id: "first", assetId: "img-1", startSeconds: 0, durationSeconds: 2 },
        { id: "second", assetId: "missing", startSeconds: 3, durationSeconds: 2 },
      ],
      imageAssetIds: ["img-1"],
      audioAssetIds: [],
      mixAssets: [],
      profile,
    });
    expect(issues).toContainEqual(expect.objectContaining({ code: "missing-image", severity: "error" }));
    expect(issues).toContainEqual(expect.objectContaining({ code: "timeline-gap", severity: "warning" }));
  });

  it("requires at least one visual clip before render", () => {
    const issues = validateRenderTimeline({
      imageClips: [],
      imageAssetIds: [],
      audioAssetIds: [],
      mixAssets: [],
      profile,
    });
    expect(issues.some((issue) => issue.code === "no-video-clips" && issue.severity === "error")).toBe(true);
  });
});
