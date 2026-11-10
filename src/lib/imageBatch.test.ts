import { describe, expect, it } from "vitest";
import { naturalSortImages, validateImageBatch } from "./imageBatch";

function file(name: string, type = "image/png", size = 10, lastModified = 1): File {
  return new File([new Uint8Array(size)], name, { type, lastModified });
}
describe("multi-image intake", () => {
  it("sorts numbered frames naturally and does not mutate input", () => {
    const entries = ["frame-10.png", "frame-2.png", "frame-1.png"].map((name) => ({ file: file(name), relativePath: name }));
    expect(naturalSortImages(entries).map((item) => item.file.name)).toEqual(["frame-1.png", "frame-2.png", "frame-10.png"]);
    expect(entries[0].file.name).toBe("frame-10.png");
  });
  it("filters non-images, empty files, oversized files, and duplicate selections", () => {
    const same = file("a.png");
    const result = validateImageBatch([same, same, file("notes.txt", "text/plain"), file("empty.png", "image/png", 0), file("huge.png", "image/png", 100 * 1024 * 1024 + 1)]);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(4);
  });
});
