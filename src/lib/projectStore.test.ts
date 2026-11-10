import { describe, expect, it } from "vitest";
import {
  createProjectBackup,
  duplicateProject,
  mergeSceneWithPrevious,
  moveBlockAcrossScenes,
  moveItem,
  splitSceneAfterBlock,
  parseProjectBackup,
  parseStoredProjects,
  type StudioProject,
} from "./projectStore";

const fixture: StudioProject = {
  id: "p1",
  name: "Pilot",
  source: "A quiet opening.",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  scenes: [{
    id: "s1",
    title: "Opening",
    chapter: "Chapter 1",
    sourceText: "A quiet opening.",
    blocks: [{
      id: "b1",
      kind: "narration",
      text: "A quiet opening.",
      sourceLine: 1,
    }],
  }],
};

const twoScenes = [
  {
    ...fixture.scenes[0],
    blocks: [
      fixture.scenes[0].blocks[0],
      { id: "b2", kind: "dialogue" as const, speaker: "MAYA", text: "Hello.", sourceLine: 2 },
    ],
  },
  {
    id: "s2",
    title: "Street",
    chapter: "Chapter 1",
    sourceText: "Thunder.",
    blocks: [{ id: "b3", kind: "sfx" as const, cue: "THUNDER", text: "", sourceLine: 3 }],
  },
];

describe("GridSplit project data", () => {
  it("round-trips projects through a versioned backup", () => {
    const contents = createProjectBackup([fixture], "2026-01-03T00:00:00.000Z");
    expect(parseProjectBackup(contents)).toEqual([{ ...fixture, archived: false }]);
  });

  it("restores valid local projects and defaults legacy archive state", () => {
    const legacy = { ...fixture };
    expect(parseStoredProjects(JSON.stringify([legacy]))).toEqual([{ ...fixture, archived: false }]);
    expect(parseStoredProjects("not-json")).toEqual([]);
    expect(parseStoredProjects(JSON.stringify({}))).toEqual([]);
  });

  it("rejects malformed and unsupported backups", () => {
    expect(() => parseProjectBackup("{")).toThrow("valid JSON");
    expect(() => parseProjectBackup(JSON.stringify({ format: "other", version: 1, projects: [] })))
      .toThrow("supported GridSplit Studio backup");
    expect(() => parseProjectBackup(JSON.stringify({
      format: "gridsplit-studio-backup",
      version: 1,
      projects: [{ id: "broken" }],
    }))).toThrow("invalid or incomplete");
  });

  it("duplicates projects with fresh nested IDs and timestamps", () => {
    let id = 0;
    const copy = duplicateProject(fixture, () => `new-${++id}`, "2026-02-01T00:00:00.000Z");
    expect(copy.name).toBe("Copy of Pilot");
    expect(copy.id).toBe("new-1");
    expect(copy.scenes[0].id).toBe("new-2");
    expect(copy.scenes[0].blocks[0].id).toBe("new-3");
    expect(copy.createdAt).toBe("2026-02-01T00:00:00.000Z");
    expect(copy.source).toBe(fixture.source);
  });

  it("remaps copied audio segment scene/block references and resets generated output", () => {
    const audioProject: StudioProject = {
      ...fixture,
      characters: [{ id: "c1", name: "Narrator", voiceId: "af_heart", language: "en-us", speed: 1, narrator: true }],
      audioSegments: [{
        id: "a1", sceneId: "s1", blockId: "b1", fingerprint: "hash", status: "ready",
        providerId: "kokoro-local", voiceId: "af_heart", language: "en-us", speed: 1,
        sampleCount: 48000, sampleRate: 24000, channels: 1, durationSeconds: 2,
        updatedAt: "2026-01-02T00:00:00.000Z",
      }],
    };
    let nextId = 0;
    const copy = duplicateProject(audioProject, () => `copy-${++nextId}`);
    expect(copy.audioSegments).toHaveLength(1);
    expect(copy.audioSegments?.[0]).toMatchObject({
      status: "pending",
      sceneId: copy.scenes[0].id,
      blockId: copy.scenes[0].blocks[0].id,
    });
    expect(copy.audioSegments?.[0].id).not.toBe("a1");
    expect(copy.audioSegments?.[0].sampleCount).toBeUndefined();
    expect(copy.characters?.[0].id).not.toBe("c1");
  });

  it("recovers interrupted generation records when projects are restored", () => {
    const interrupted = {
      ...fixture,
      audioSegments: [
        { id: "a1", sceneId: "s1", blockId: "b1", fingerprint: "a", status: "generating",
          providerId: "local", voiceId: "voice", language: "en-us", speed: 1, updatedAt: "now" },
        { id: "a2", sceneId: "s1", blockId: "b1", fingerprint: "b", status: "generating",
          providerId: "local", voiceId: "voice", language: "en-us", speed: 1, sampleCount: 24,
          sampleRate: 24, channels: 1, durationSeconds: 1, updatedAt: "now" },
      ],
    };
    const restored = parseStoredProjects(JSON.stringify([interrupted]))[0];
    expect(restored.audioSegments?.map((item) => item.status)).toEqual(["pending", "ready"]);
  });

  it("moves blocks between adjacent scenes without losing them", () =>
    const moved = moveBlockAcrossScenes(twoScenes, 0, 1, 1);
    expect(moved[0].blocks.map((block) => block.id)).toEqual(["b1"]);
    expect(moved[1].blocks.map((block) => block.id)).toEqual(["b2", "b3"]);
  });

  it("splits a scene after a selected block", () => {
    const split = splitSceneAfterBlock(twoScenes, 0, 0, () => "split-scene");
    expect(split).toHaveLength(3);
    expect(split[0].blocks.map((block) => block.id)).toEqual(["b1"]);
    expect(split[1].id).toBe("split-scene");
    expect(split[1].blocks.map((block) => block.id)).toEqual(["b2"]);
  });

  it("merges a scene into the previous scene", () => {
    const merged = mergeSceneWithPrevious(twoScenes, 1);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("s1");
    expect(merged[0].blocks.map((block) => block.id)).toEqual(["b1", "b2", "b3"]);
  });

  it("reorders items and leaves boundary moves unchanged", () => {
    expect(moveItem(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    const items = ["a", "b"];
    expect(moveItem(items, 0, -1)).toBe(items);
    expect(moveItem(items, 1, 1)).toBe(items);
  });
});
