import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import type { StudioProject } from "../../lib/projectStore";

vi.mock("../../lib/portableProject", () => ({
  exportPortableProject: vi.fn(async () => new Blob(["project archive fixture"])),
}));

import { buildColabRenderPackage, buildDriveSyncNotebook } from "./colabExport";

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

  it("pins Smart Sync to a PyAV version compatible with faster-whisper", async () => {
    const blob = buildDriveSyncNotebook();
    const notebook = JSON.parse(await blob.text()) as { cells: Array<{ source: string[] }> };
    const code = notebook.cells[1].source.join("");

    expect(code).toContain("faster-whisper==1.2.1");
    expect(code).toContain("av==18.1.0");
    expect(code).toContain("if av_version >= (19, 0)");
    expect(code).toContain("restart the Colab runtime");
  });
});
