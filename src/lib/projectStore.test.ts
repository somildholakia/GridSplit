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

  it("moves blocks between adjacent scenes without losing them", () => {
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
