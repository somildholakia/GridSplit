import { describe, expect, it } from "vitest";
import { buildSynchronizationMetadata, toSrt, toVtt } from "./mediaTimeline";
import { parseScript } from "./scriptParser";
import { buildProductionTimeline, timelineDurationSeconds } from "./productionTimeline";
import type { ImageSequenceAsset } from "./imageSequence";

describe("GridSplit script-to-storyboard integration", () => {
  it("parses script blocks, builds measured sync, maps images and creates captions", () => {
    const source = [
      "Chapter 1: The Arrival",
      "Scene 1: The Signal",
      "[NARRATOR] The radio crackled in the empty station.",
      "[CHARACTER: Mira] Did you hear that?",
      "[SFX: STATIC] A burst of static.",
      "Scene 2: The Door",
      "[NARRATOR] The old door opened slowly.",
    ].join("\n\n");

    const scenes = parseScript(source);
    expect(scenes).toHaveLength(2);
    expect(scenes[0].blocks.map((block) => block.kind)).toEqual(["narration", "dialogue", "sfx"]);
    expect(scenes[0].blocks[1].speaker).toBe("MIRA");
    expect(scenes[1].chapter).toBe("Chapter 1: The Arrival");

    const speech = scenes.flatMap((scene) =>
      scene.blocks.filter((block) => block.kind === "narration" || block.kind === "dialogue")
        .map((block, index) => ({
          id: "segment-" + block.id,
          sceneId: scene.id,
          blockId: block.id,
          text: block.text,
          speaker: block.speaker,
          sampleCount: (index + 1) * 24000,
          sampleRate: 48000,
        })),
    );
    const synchronization = buildSynchronizationMetadata(speech);
    expect(synchronization.totalDurationSeconds).toBe(2);
    expect(toSrt(synchronization)).toContain("MIRA: Did you hear that?");
    expect(toVtt(synchronization)).toMatch(/^WEBVTT/);

    const images: ImageSequenceAsset[] = [
      { id: "image-1", fileName: "001.png", relativePath: "001.png", mimeType: "image/png", sizeBytes: 10, sequenceNumber: 1, fingerprint: "a" },
      { id: "image-2", fileName: "002.png", relativePath: "002.png", mimeType: "image/png", sizeBytes: 10, sequenceNumber: 2, fingerprint: "b" },
      { id: "image-3", fileName: "003.png", relativePath: "003.png", mimeType: "image/png", sizeBytes: 10, sequenceNumber: 3, fingerprint: "c" },
    ];
    const result = buildProductionTimeline({
      scenes,
      images,
      mappings: [{ sceneId: scenes[0].id, imageIds: ["image-1", "image-2"] }, { sceneId: scenes[1].id, imageIds: ["image-3"] }],
      synchronization,
      updatedAt: "2026-11-10T00:00:00.000Z",
    });
    expect(result.timeline.tracks[0].clips).toHaveLength(3);
    expect(result.timeline.tracks[1].clips).toHaveLength(3);
    expect(timelineDurationSeconds(result.timeline)).toBe(2);
    expect(result.warnings).toHaveLength(0);
  });
});

describe("GridSplit large-project performance smoke", () => {
  it("processes a 500-scene, 500-image narration timeline within a generous regression budget", () => {
    const script = Array.from({ length: 500 }, (_, index) =>
      "Scene " + (index + 1) + ": Scene " + (index + 1) + "\n[NARRATOR] Narration for scene " + (index + 1) + ".",
    ).join("\n\n");
    const started = Date.now();
    const scenes = parseScript(script);
    const segments = scenes.map((scene) => ({
      id: "segment-" + scene.id,
      sceneId: scene.id,
      blockId: scene.blocks[0].id,
      text: scene.blocks[0].text,
      sampleCount: 48000,
      sampleRate: 48000,
    }));
    const synchronization = buildSynchronizationMetadata(segments);
    const images: ImageSequenceAsset[] = scenes.map((scene, index) => ({
      id: "image-" + index,
      fileName: String(index + 1).padStart(4, "0") + ".png",
      relativePath: String(index + 1).padStart(4, "0") + ".png",
      mimeType: "image/png",
      sizeBytes: 1024,
      sequenceNumber: index + 1,
      fingerprint: "fingerprint-" + index,
    }));
    const timeline = buildProductionTimeline({
      scenes,
      images,
      mappings: scenes.map((scene, index) => ({ sceneId: scene.id, imageIds: [images[index].id] })),
      synchronization,
    }).timeline;
    const elapsedMs = Date.now() - started;

    expect(scenes).toHaveLength(500);
    expect(timeline.tracks.flatMap((track) => track.clips)).toHaveLength(1000);
    expect(elapsedMs).toBeLessThan(10000);
  });
});
