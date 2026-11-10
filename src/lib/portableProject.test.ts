import { describe, expect, it } from "vitest";
import { remapRestoredProject, validatePortableManifest, type PortableProject } from "./portableProject";

const imageEntry = {
  path: "media/images/frame-0001.png",
  kind: "image",
  assetId: "image-1",
  mimeType: "image/png",
  sizeBytes: 1024,
  sha256: "a".repeat(64),
};

const manifest = (files: unknown[]) => ({
  format: "gridsplit-studio-project",
  version: 1,
  createdAt: "2026-11-10T00:00:00.000Z",
  projectId: "project-1",
  files,
});

describe("portable project archive manifest", () => {
  it("accepts a versioned manifest with portable relative media paths", () => {
    const parsed = validatePortableManifest(manifest([imageEntry]));
    expect(parsed.projectId).toBe("project-1");
    expect(parsed.files).toEqual([imageEntry]);
  });

  it("rejects traversal, absolute and platform-specific paths", () => {
    for (const path of [
      "media/images/../../escape.png",
      "/media/images/frame.png",
      "media\\images\\frame.png",
      "C:/media/images/frame.png",
    ]) {
      expect(() => validatePortableManifest(manifest([{ ...imageEntry, path }]))).toThrow();
    }
  });

  it("requires media kind and archive folder to agree", () => {
    expect(() => validatePortableManifest(manifest([{
      ...imageEntry,
      path: "media/mix-audio/frame.png",
      kind: "image",
    }]))).toThrow(/invalid or unsafe/);
  });

  it("rejects duplicate paths, malformed hashes and excessive file counts", () => {
    expect(() => validatePortableManifest(manifest([imageEntry, imageEntry]))).toThrow(/invalid or unsafe/);
    expect(() => validatePortableManifest(manifest([{ ...imageEntry, sha256: "not-a-hash" }]))).toThrow(/invalid or unsafe/);
    expect(() => validatePortableManifest(manifest(Array.from({ length: 1601 }, (_, index) => ({
      ...imageEntry,
      assetId: "image-" + index,
      path: "media/images/image-" + index + ".png",
    }))))).toThrow(/supported GridSplit/);
  });
});

describe("portable project restoration remapping", () => {
  it("creates independent IDs and keeps all scene, media, mapping, timeline and effect references connected", () => {
    const source: PortableProject = {
      id: "original-project",
      name: "Pilot",
      source: "A quiet opening.",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      scenes: [{
        id: "scene-1",
        title: "Opening",
        chapter: "Chapter 1",
        sourceText: "Narration",
        blocks: [{ id: "block-1", kind: "narration", text: "Narration", sourceLine: 1 }],
      }],
      characters: [{
        id: "speaker-1", name: "Narrator", voiceId: "af_heart", language: "en-us", speed: 1, narrator: true,
      }],
      audioSegments: [{
        id: "segment-1", sceneId: "scene-1", blockId: "block-1", fingerprint: "speech-hash",
        status: "ready", providerId: "kokoro-local", voiceId: "af_heart", language: "en-us", speed: 1,
        sampleCount: 48000, sampleRate: 24000, channels: 1, durationSeconds: 2, updatedAt: "now",
      }],
      imageAssets: [{
        id: "image-1", name: "frame-1.png", relativePath: "frames/frame-1.png", mimeType: "image/png",
        bytes: 1024, sequenceNumber: 1, order: 0, width: 640, height: 360, fingerprint: "image-hash",
      }],
      imageMappings: [{ sceneId: "scene-1", imageIds: ["image-1"] }],
      timelineClips: [
        { id: "clip-image", track: "images", sceneId: "scene-1", assetId: "image-1", startSeconds: 0, durationSeconds: 2, order: 0 },
        { id: "clip-audio", track: "audio", sceneId: "scene-1", segmentId: "segment-1", startSeconds: 0, durationSeconds: 2, order: 0 },
      ],
      audioMixTracks: [{
        id: "music-track", kind: "music", name: "Music", volume: 0.35, muted: false, solo: false,
        fadeInSeconds: 1, fadeOutSeconds: 2,
      }],
      mixAssets: [{
        id: "music-asset", name: "score.wav", mimeType: "audio/wav", bytes: 2048,
        kind: "music", trackId: "music-track", startSeconds: 0, durationSeconds: 2, order: 0,
      }],
      videoClipEdits: [{
        clipId: "clip-image", effect: "ken-burns", transitionIn: "fade", transitionOut: "cut",
        transitionDurationSeconds: 0.5, zoom: 1.12,
      }],
      renderProfile: { width: 1920, height: 1080, fps: 30, aspectRatio: "16:9", quality: "balanced" },
    };
    let id = 0;
    const { project, imageIds, segmentIds, mixAssetIds, trackIds } = remapRestoredProject(
      source,
      () => "restored-" + (++id),
    );

    expect(project.id).not.toBe(source.id);
    expect(project.name).toContain("Restored:");
    expect(project.scenes[0].id).not.toBe("scene-1");
    expect(project.scenes[0].blocks[0].id).not.toBe("block-1");
    expect(project.imageAssets?.[0].id).toBe(imageIds.get("image-1"));
    expect(project.imageMappings?.[0]).toEqual({
      sceneId: project.scenes[0].id,
      imageIds: [project.imageAssets?.[0].id],
    });
    expect(project.timelineClips?.find((clip) => clip.track === "images")?.assetId).toBe(project.imageAssets?.[0].id);
    expect(project.timelineClips?.find((clip) => clip.track === "audio")?.segmentId).toBe(project.audioSegments?.[0].id);
    expect(project.audioSegments?.[0].id).toBe(segmentIds.get("segment-1"));
    expect(project.audioSegments?.[0].status).toBe("pending");
    expect(project.audioMixTracks?.[0].id).toBe(trackIds.get("music-track"));
    expect(project.audioMixTracks?.[0].id).not.toBe("music-track");
    expect(project.mixAssets?.[0].id).toBe(mixAssetIds.get("music-asset"));
    expect(project.mixAssets?.[0].trackId).toBe(project.audioMixTracks?.[0].id);
    expect(project.videoClipEdits?.[0].clipId).toBe(project.timelineClips?.[0].id);
    expect(project.renderProfile).toEqual(source.renderProfile);
  });
});
