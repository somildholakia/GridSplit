import { describe, expect, it } from "vitest";
import { MAX_BATCH_IMAGE_COUNT, naturalSortImages, validateImageBatch } from "./imageBatch";

function file(name: string, type = "image/png", size = 10, lastModified = 1): File {
  return new File([new Uint8Array(size)], name, { type, lastModified });
}
describe("multi-image intake", () => {
  it("sorts numbered frames naturally and does not mutate input", () => {
    const entries = ["frame-10.png", "frame-2.png", "frame-1.png"].map((name) => ({ file: file(name), relativePath: name }));
    expect(naturalSortImages(entries).map((item) => item.file.name)).toEqual(["frame-1.png", "frame-2.png", "frame-10.png"]);
    expect(entries[0].file.name).toBe("frame-10.png");
  });
  it("sorts nested folder paths naturally", () => {
    const entries = [
      { file: file("frame-1.png"), relativePath: "Scene 10/frame-1.png" },
      { file: file("frame-10.png"), relativePath: "Scene 2/frame-10.png" },
      { file: file("frame-2.png"), relativePath: "Scene 2/frame-2.png" },
    ];
    expect(naturalSortImages(entries).map((item) => item.relativePath)).toEqual([
      "Scene 2/frame-2.png", "Scene 2/frame-10.png", "Scene 10/frame-1.png",
    ]);
  });
  it("filters non-images, empty files, oversized files, and duplicate selections", () => {
    const same = file("a.png");
    const result = validateImageBatch([same, same, file("notes.txt", "text/plain"), file("empty.png", "image/png", 0), file("huge.png", "image/png", 100 * 1024 * 1024 + 1)]);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(4);
  });
  it("caps each intake batch at the documented maximum", () => {
    const files = Array.from({ length: MAX_BATCH_IMAGE_COUNT + 1 }, (_, index) => file(`frame-${index + 1}.png`));
    const result = validateImageBatch(files);
    expect(result.accepted).toHaveLength(MAX_BATCH_IMAGE_COUNT);
    expect(result.rejected).toContain(`Only the first ${MAX_BATCH_IMAGE_COUNT} images can be imported at once.`);
  });
});
