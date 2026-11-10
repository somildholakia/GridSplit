import { describe, expect, it } from "vitest";
import {
  createProjectBackup,
  duplicateProject,
  moveItem,
  parseProjectBackup,
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

describe("GridSplit project data", () => {
  it("round-trips projects through a versioned backup", () => {
    const contents = createProjectBackup([fixture], "2026-01-03T00:00:00.000Z");
    expect(parseProjectBackup(contents)).toEqual([{ ...fixture, archived: false }]);
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

  it("reorders items and leaves boundary moves unchanged", () => {
    expect(moveItem(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    const items = ["a", "b"];
    expect(moveItem(items, 0, -1)).toBe(items);
    expect(moveItem(items, 1, 1)).toBe(items);
  });
});
