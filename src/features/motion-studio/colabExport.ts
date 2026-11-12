import JSZip from "jszip";
import type { StudioProject } from "../../lib/projectStore";
import { exportPortableProject } from "../../lib/portableProject";
import rendererSource from "../../../local-render/server.py?raw";

const notebookCode = String.raw`!apt-get -qq update && apt-get -qq install -y ffmpeg
!nvidia-smi || true

from google.colab import files
from pathlib import Path
import importlib.util
import json
import subprocess
import sys
import zipfile

uploaded = files.upload()
package_name = next((name for name in uploaded if name.lower().endswith(".zip")), None)
if not package_name:
    raise RuntimeError("Upload the GridSplit Motion Studio Colab package ZIP.")

bundle_root = Path("/content/gridsplit-motion-bundle")
bundle_root.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(package_name) as bundle:
    for entry in bundle.infolist():
        target = (bundle_root / entry.filename).resolve()
        if bundle_root.resolve() not in target.parents and target != bundle_root.resolve():
            raise RuntimeError("Unsafe path in package ZIP.")
    bundle.extractall(bundle_root)

renderer_path = bundle_root / "local-render" / "server.py"
spec = importlib.util.spec_from_file_location("gridsplit_local_renderer", renderer_path)
renderer = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = renderer
spec.loader.exec_module(renderer)

project_archive = bundle_root / "motion-project.gridsplit.zip"
render_root = Path("/content/gridsplit-motion-render")
render_root.mkdir(parents=True, exist_ok=True)
manifest, project = renderer.extract_verified_archive(project_archive, render_root)

profile_settings = project.setdefault("renderProfile", {})
profile_settings["encoder"] = "nvidia"
command, expected_duration, profile = renderer.render_command(project, manifest, render_root)
print("Selected encoder:", profile["encoder"])
print("Output:", profile["width"], "x", profile["height"], "at", profile["fps"], "FPS")

run = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
if run.returncode != 0:
    raise RuntimeError("FFmpeg render failed:\n" + run.stdout[-8000:])

output_path = render_root / "output.mp4"
if not output_path.exists() or output_path.stat().st_size < 1024:
    raise RuntimeError("FFmpeg did not create a valid MP4.")

probe = subprocess.run([
    profile["ffprobe"], "-v", "error", "-show_entries",
    "format=duration,format_name:stream=codec_type,codec_name,width,height,r_frame_rate",
    "-of", "json", str(output_path)
], capture_output=True, text=True, check=True)
report = json.loads(probe.stdout)
video = next(stream for stream in report["streams"] if stream["codec_type"] == "video")
audio = next(stream for stream in report["streams"] if stream["codec_type"] == "audio")
actual_duration = float(report["format"]["duration"])

assert video["codec_name"] == "h264" and audio["codec_name"] == "aac", "Unexpected output codecs."
assert (video["width"], video["height"]) == (profile["width"], profile["height"]), "Output dimensions do not match the project."
assert abs(actual_duration - expected_duration) <= max(0.25, 2 / profile["fps"]), "Output duration does not match the timeline."

print("Validated MP4:", round(actual_duration, 2), "seconds")
print("Selected video encoder:", profile["encoder"])
files.download(str(output_path))
`;

const notebook = {
  cells: [
    {
      cell_type: "markdown",
      metadata: {},
      source: [
        "# GridSplit Motion Studio · Colab GPU render\n",
        "\n",
        "This notebook renders the bundled GridSplit project archive with FFmpeg. It uses NVIDIA NVENC when the runtime exposes it (for example, a T4 GPU) and otherwise falls back to libx264. No AI model or API key is used.\n",
        "\n",
        "Choose Runtime → Change runtime type → T4 GPU before running when that accelerator is available."
      ]
    },
    {
      cell_type: "code",
      execution_count: null,
      metadata: {},
      outputs: [],
      source: notebookCode.split("\n").map((line) => line + "\n")
    }
  ],
  metadata: {
    colab: { name: "GridSplit_Motion_Studio_T4.ipynb", provenance: [] },
    kernelspec: { display_name: "Python 3", name: "python3" },
    language_info: { name: "python" }
  },
  nbformat: 4,
  nbformat_minor: 5
};

export async function buildColabRenderPackage(project: StudioProject): Promise<Blob> {
  const projectArchive = await exportPortableProject(project);
  const bundle = new JSZip();
  bundle.file("motion-project.gridsplit.zip", projectArchive);
  bundle.file("local-render/server.py", rendererSource);
  bundle.file("GridSplit_Motion_Studio_T4.ipynb", JSON.stringify(notebook, null, 2));
  bundle.file("README-COLAB.txt", [
    "GridSplit Motion Studio · Colab GPU render",
    "",
    "1. Open GridSplit_Motion_Studio_T4.ipynb in Google Colab.",
    "2. Choose Runtime → Change runtime type → T4 GPU if that option is available.",
    "3. Run the notebook cell and upload this complete package ZIP when prompted.",
    "4. The notebook uses NVIDIA NVENC when FFmpeg and the runtime expose h264_nvenc; otherwise it uses libx264.",
    "5. The validated MP4 is downloaded at the end of the cell.",
    "",
    "Colab GPU availability and session limits are controlled by Google. This package contains your project media; upload it only to a Colab account you trust.",
    "The notebook does not call AI inference APIs or require an API key."
  ].join("\n"));
  return bundle.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 3 } });
}

export function downloadMotionPackage(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
