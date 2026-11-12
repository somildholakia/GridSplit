import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import type { StudioProject } from "../../lib/projectStore";

vi.mock("../../lib/portableProject", () => ({
  exportPortableProject: vi.fn(async () => new Blob(["project archive fixture"])),
}));

import { buildColabRenderPackage } from "./colabExport";

describe("Motion Studio Colab package", () => {
  it("bundles the portable project, renderer and a runnable notebook", async () => {
    const blob = await buildColabRenderPackage({} as StudioProject);
    const archive = await JSZip.loadAsync(blob);

    expect(archive.file("motion-project.gridsplit.zip")).not.toBeNull();
    expect(archive.file("local-render/server.py")).not.toBeNull();
    expect(archive.file("README-COLAB.txt")).not.toBeNull();

    const notebookText = await archive.file("GridSplit_Motion_Studio_T4.ipynb")!.async("string");
    const notebook = JSON.parse(notebookText) as { cells: Array<{ source: string[] }> };
    expect(notebook.cells).toHaveLength(2);
    const code = notebook.cells[1].source.join("");
    expect(code).toContain("h264_nvenc");
    expect(code).toContain("retrying with CPU libx264");
    expect(code).toContain("files.download(str(output_path))");
  });
});
