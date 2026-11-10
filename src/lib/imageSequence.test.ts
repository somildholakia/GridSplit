import { describe, expect, it } from "vitest";
import {
  findDuplicateImageGroups,
  findSequenceGaps,
  moveImageSequenceItem,
  renumberImageSequence,
  sequenceNumberFromName,
  type ImageSequenceAsset,
} from "./imageSequence";

const asset = (id: string, sequenceNumber: number | null, fingerprint = id): ImageSequenceAsset => ({
  id,
  fileName: id + ".png",
  relativePath: id + ".png",
  mimeType: "image/png",
  sizeBytes: 10,
  sequenceNumber,
  fingerprint,
});

describe("image sequence helpers", () => {
  it("reads the last numeric token before a file extension", () => {
    expect(sequenceNumberFromName("scene_02/frame-0012.png")).toBe(12);
    expect(sequenceNumberFromName("frame.png")).toBeNull();
    expect(sequenceNumberFromName("frame-999999999999.png")).toBeNull();
  });

  it("detects missing numbers without treating repeated values as gaps", () => {
    expect(findSequenceGaps([asset("1", 1), asset("3", 3), asset("3b", 3), asset("5", 5)])).toEqual([2, 4]);
    expect(findSequenceGaps([asset("a", null), asset("b", null)])).toEqual([]);
  });

  it("groups possible duplicates for human review", () => {
    const groups = findDuplicateImageGroups([
      asset("a", 1, "same"), asset("b", 2, "same"), asset("c", 3, "different"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("moves sequence items and renumbers the corrected order", () => {
    const moved = moveImageSequenceItem([asset("a", 1), asset("b", 2), asset("c", 3)], "c", -1);
    expect(moved.map((item) => item.id)).toEqual(["a", "c", "b"]);
    expect(renumberImageSequence(moved).map((item) => item.sequenceNumber)).toEqual([1, 2, 3]);
    expect(moveImageSequenceItem(moved, "missing", 1)).toBe(moved);
  });
});
