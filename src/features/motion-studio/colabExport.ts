import JSZip from "jszip";
import type { StudioProject } from "../../lib/projectStore";
import { exportPortableProject } from "../../lib/portableProject";
import rendererSource from "../../../local-render/server.py?raw";
import gatewaySource from "../../../local-render/colab_server.py?raw";
import syncAnalyzerSource from "../../../local-render/sync_analyzer.py?raw";


const offlineNotebookCode = String.raw`!apt-get -qq update && apt-get -qq install -y ffmpeg
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
run = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
if run.returncode != 0 and profile.get("encoder") == "h264_nvenc":
    print("NVENC render failed in this runtime; retrying with CPU libx264.")
    profile_settings["encoder"] = "software"
    command, expected_duration, profile = renderer.render_command(project, manifest, render_root)
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
assert video["codec_name"] == "h264" and audio["codec_name"] == "aac"
assert (video["width"], video["height"]) == (profile["width"], profile["height"])
assert abs(actual_duration - expected_duration) <= max(0.25, 2 / profile["fps"])
print("Validated MP4:", round(actual_duration, 2), "seconds")
print("Selected video encoder:", profile["encoder"])
files.download(str(output_path))
`;

export async function buildColabRenderPackage(project: StudioProject): Promise<Blob> {
  const projectArchive = await exportPortableProject(project);
  const bundle = new JSZip();
  bundle.file("motion-project.gridsplit.zip", projectArchive);
  bundle.file("local-render/server.py", rendererSource);
  bundle.file("GridSplit_Motion_Studio_T4.ipynb", JSON.stringify({
    cells: [
      {
        cell_type: "markdown", metadata: {},
        source: [
          "# GridSplit Motion Studio · Colab GPU render\n",
          "\n",
          "Upload this complete ZIP in the notebook cell. NVENC is used only after the renderer verifies it, with CPU fallback."
        ]
      },
      {
        cell_type: "code", execution_count: null, metadata: {}, outputs: [],
        source: offlineNotebookCode.split("\n").map((line) => line + "\n")
      }
    ],
    metadata: {
      colab: { name: "GridSplit_Motion_Studio_T4.ipynb", provenance: [] },
      kernelspec: { display_name: "Python 3", name: "python3" },
      language_info: { name: "python" }
    },
    nbformat: 4,
    nbformat_minor: 5
  }, null, 2));
  bundle.file("GridSplit_Live_Colab_Renderer.ipynb", buildColabNotebook());
  bundle.file("README-COLAB.txt", [
    "GridSplit Motion Studio · Colab render",
    "",
    "Offline workflow:",
    "1. Open GridSplit_Motion_Studio_T4.ipynb in Colab.",
    "2. Select a T4 GPU when available.",
    "3. Run the notebook and upload this complete ZIP when prompted.",
    "4. The validated MP4 is downloaded after FFmpeg completes.",
    "",
    "Live workflow:",
    "1. Open GridSplit_Live_Colab_Renderer.ipynb in Colab.",
    "2. Select a T4 GPU, run all cells, then copy the Quick Tunnel URL into Production Studio.",
    "",
    "GPU availability and session limits are controlled by Google. No paid API key or AI model is required."
  ].join("\n"));
  return bundle.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 3 } });
}

function encodeBase64(source: string): string {
  const bytes = new TextEncoder().encode(source);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function notebookCell(cell_type: "markdown" | "code", source: string) {
  return cell_type === "markdown"
    ? { cell_type, metadata: {}, source: source.split("\n").map((line) => line + "\n") }
    : { cell_type, execution_count: null, metadata: {}, outputs: [], source: source.split("\n").map((line) => line + "\n") };
}

export function buildColabNotebook(): Blob {
  const rendererBase64 = encodeBase64(rendererSource);
  const gatewayBase64 = encodeBase64(gatewaySource);
  const installCode = [
    "!apt-get -qq update && apt-get -qq install -y ffmpeg curl",
    "import os, platform, subprocess, urllib.request",
    "architecture = platform.machine().lower()",
    "cloudflared_asset = {'x86_64': 'amd64', 'amd64': 'amd64', 'aarch64': 'arm64', 'arm64': 'arm64'}.get(architecture)",
    "if not cloudflared_asset:",
    "    raise RuntimeError('Unsupported Colab CPU architecture: ' + architecture)",
    "cloudflared_url = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-' + cloudflared_asset",
    "urllib.request.urlretrieve(cloudflared_url, '/usr/local/bin/cloudflared')",
    "os.chmod('/usr/local/bin/cloudflared', 0o755)",
    "subprocess.run(['ffmpeg', '-version'], check=True, stdout=subprocess.DEVNULL)",
    "print('FFmpeg:', subprocess.check_output(['ffmpeg', '-version'], text=True).splitlines()[0])",
    "try:",
    "    gpu = subprocess.check_output(['nvidia-smi', '--query-gpu=name', '--format=csv,noheader'], text=True, stderr=subprocess.STDOUT).strip()",
    "    print('NVIDIA GPU detected:', gpu.splitlines()[0] if gpu else 'none')",
    "except (FileNotFoundError, subprocess.CalledProcessError):",
    "    print('No NVIDIA GPU detected. The renderer will use CPU libx264.')",
    "print('Cloudflare Quick Tunnel binary ready.')",
  ].join("\n");

  const startCode = [
    "import base64, json, os, pathlib, re, secrets, subprocess, sys, threading, time, urllib.request",
    "from IPython.display import Markdown, display",
    "",
    "BUNDLE_ROOT = pathlib.Path('/content/gridsplit-colab')",
    "RENDER_ROOT = BUNDLE_ROOT / 'local-render'",
    "RENDER_ROOT.mkdir(parents=True, exist_ok=True)",
    "RENDERER_SOURCE_B64 = " + JSON.stringify(rendererBase64),
    "GATEWAY_SOURCE_B64 = " + JSON.stringify(gatewayBase64),
    "(RENDER_ROOT / 'server.py').write_bytes(base64.b64decode(RENDERER_SOURCE_B64))",
    "(RENDER_ROOT / 'colab_server.py').write_bytes(base64.b64decode(GATEWAY_SOURCE_B64))",
    "",
    "# Generated for this runtime only. It is not embedded in the notebook or repository.",
    "PORT = 8766",
    "SERVER_PROCESS = subprocess.Popen(",
    "    [sys.executable, str(RENDER_ROOT / 'colab_server.py'), '--host', '127.0.0.1', '--port', str(PORT)],",
    "    cwd=str(RENDER_ROOT), env=os.environ.copy(), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,",
    ")",
    "",
    "# Wait until the direct Colab API is actually healthy before tunnelling it.",
    "health_request = urllib.request.Request(",
    "    f'http://127.0.0.1:{PORT}/v1/health',",
    ")",
    "for attempt in range(60):",
    "    if SERVER_PROCESS.poll() is not None:",
    "        raise RuntimeError('The GridSplit renderer process exited during startup.')",
    "    try:",
    "        with urllib.request.urlopen(health_request, timeout=2) as response:",
    "            health = json.loads(response.read().decode('utf-8'))",
    "        if health.get('ready') is True:",
    "            break",
    "    except Exception:",
    "        time.sleep(1)",
    "else:",
    "    raise RuntimeError('The GridSplit Colab renderer did not become ready.')",
    "",
    "TUNNEL_PROCESS = subprocess.Popen(",
    "    ['/usr/local/bin/cloudflared', 'tunnel', '--url', f'http://127.0.0.1:{PORT}', '--no-autoupdate'],",
    "    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1,",
    ")",
    "TUNNEL_READY = threading.Event()",
    "TUNNEL_STATE = {'url': None, 'last_output': ''}",
    "def _read_quick_tunnel_output():",
    "    for line in iter(TUNNEL_PROCESS.stdout.readline, ''):",
    "        TUNNEL_STATE['last_output'] = line[-500:]",
    "        match = re.search(r'https://[a-z0-9-]+\\.trycloudflare\\.com', line, re.I)",
    "        if match:",
    "            TUNNEL_STATE['url'] = match.group(0)",
    "            TUNNEL_READY.set()",
    "            return",
    "threading.Thread(target=_read_quick_tunnel_output, daemon=True).start()",
    "if not TUNNEL_READY.wait(120):",
    "    TUNNEL_PROCESS.terminate()",
    "    raise RuntimeError('Cloudflare Quick Tunnel did not provide a URL within 120 seconds. Check the Colab runtime internet connection.')",
    "",
    "GRID_SPLIT_TUNNEL_URL = TUNNEL_STATE['url']",
    "GPU_NAME = None",
    "try:",
    "    GPU_NAME = subprocess.check_output(['nvidia-smi', '--query-gpu=name', '--format=csv,noheader'], text=True, stderr=subprocess.STDOUT).strip().splitlines()[0]",
    "except Exception:",
    "    pass",
    "print('GridSplit Colab renderer is ready.')",
    "print('GPU visible to this runtime:', GPU_NAME or 'No NVIDIA GPU detected (CPU rendering will be used)')",
    "print('Colab Quick Tunnel URL:', GRID_SPLIT_TUNNEL_URL)",
    "print('Paste this URL into GridSplit → Production Studio → Export & restore.')",
    "print('Keep this Colab runtime running while GridSplit uploads and renders your project.')",
  ].join("\n");

  const notebook = {
    cells: [
      notebookCell("markdown", [
        "# GridSplit Motion Studio · Live Colab Renderer",
        "",
        "This notebook starts the **same FFmpeg renderer used by GridSplit's local rendering option** behind a temporary Cloudflare Quick Tunnel.",
        "",
        "1. In Colab, choose **Runtime → Change runtime type → T4 GPU** when available.",
        "2. Run the notebook cells from top to bottom.",
        "3. Copy the displayed Quick Tunnel URL into GridSplit → Production Studio → Export & restore.",
        "4. Connect, then start a render. GridSplit uploads the portable project archive in retryable chunks and downloads the validated MP4 in byte ranges.",
        "",
        "The renderer binds to loopback and accepts direct browser requests from GridSplit. No GridSplit login or connection token is required.",
        "",
        "**Keep the runtime and this tunnel process alive until the MP4 has downloaded.** Colab session limits and GPU availability are controlled by Google."
      ].join("\n")),
      notebookCell("code", installCode),
      notebookCell("code", startCode),
    ],
    metadata: {
      colab: { name: "GridSplit_Live_Colab_Renderer.ipynb", provenance: [] },
      kernelspec: { display_name: "Python 3", name: "python3" },
      language_info: { name: "python" },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
  return new Blob([JSON.stringify(notebook, null, 2)], {
    type: "application/x-ipynb+json;charset=utf-8",
  });
}


export function buildDriveSyncNotebook(): Blob {
  const analyzerBase64 = encodeBase64(syncAnalyzerSource);
  const rendererBase64 = encodeBase64(rendererSource);
  const gatewayBase64 = encodeBase64(gatewaySource);
  const setupCode = [
    "!apt-get -qq update && apt-get -qq install -y ffmpeg curl",
    "!pip -q install --upgrade \"faster-whisper==1.2.1\" \"av==18.1.0\" transformers accelerate \"pillow<13\" \"numpy<2.5\"",
    "import glob, os, subprocess, sys",
    "GPU_READY = subprocess.run([\"nvidia-smi\"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0",
    "if GPU_READY:",
    "    print(\"NVIDIA GPU detected; installing CUDA 12 cuBLAS and cuDNN runtime libraries for faster-whisper.\")",
    "    subprocess.check_call([sys.executable, \"-m\", \"pip\", \"-q\", \"install\", \"nvidia-cublas-cu12\", \"nvidia-cudnn-cu12\"])",
    "    cuda_lib_dirs = []",
    "    for pattern in [sys.prefix + \"/lib/python*/site-packages/nvidia/cublas/lib\", sys.prefix + \"/lib/python*/site-packages/nvidia/cudnn/lib\"]:",
    "        cuda_lib_dirs.extend(path for path in glob.glob(pattern) if os.path.isdir(path))",
    "    if cuda_lib_dirs:",
    "        os.environ[\"LD_LIBRARY_PATH\"] = os.pathsep.join(cuda_lib_dirs + [os.environ.get(\"LD_LIBRARY_PATH\", \"\")])",
    "    missing = [name for name in [\"libcublas.so.12\", \"libcudnn.so.9\"] if not any(glob.glob(path + \"/\" + name + \"*\") for path in cuda_lib_dirs)]",
    "    if missing: print(\"CUDA runtime libraries not found after install:\", missing, \"— Whisper will use CPU fallback.\")",
    "else:",
    "    print(\"No NVIDIA GPU attached to this Colab runtime; faster-whisper will use CPU int8.\")",
    "from google.colab import drive, files",
    "from pathlib import Path",
    "import base64, importlib.util, json",
    "import av",
    "from importlib.metadata import version",
    "av_version = tuple(int(part) for part in av.__version__.split('.')[:2])",
    "print('faster-whisper:', version('faster-whisper'), '| PyAV:', av.__version__)",
    "if av_version >= (19, 0):",
    "    raise RuntimeError('Incompatible PyAV version. The notebook must install av==18.1.0. Restart the Colab runtime and run all cells again.')",
    "drive.mount('/content/drive')",
    "",
    "# Edit these three values if your Drive folder or filenames are different.",
    "FOLDER_PATH = '/content/drive/MyDrive/youtube video mars 1'",
    "IMAGE_ZIP_NAME = 'mars E1 zip.zip'",
    "AUDIO_FILE_NAME = 'Mars-E1-complete-audio.wav'",
    "OUTPUT_JSON_NAME = 'gridsplit-sync.json'",
    "WHISPER_MODEL = 'small'  # T4: small is a good speed/quality balance.",
    "",
    "ANALYZER_SOURCE = base64.b64decode(" + JSON.stringify(analyzerBase64) + ")",
    "ANALYZER_PATH = Path('/content/gridsplit_sync_analyzer.py')",
    "ANALYZER_PATH.write_bytes(ANALYZER_SOURCE)",
    "spec = importlib.util.spec_from_file_location('gridsplit_sync_analyzer', ANALYZER_PATH)",
    "analyzer = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(analyzer)",
    "result = analyzer.analyze_drive_folder(",
    "    folder_path=FOLDER_PATH,",
    "    archive_name=IMAGE_ZIP_NAME,",
    "    audio_name=AUDIO_FILE_NAME,",
    "    output_json=OUTPUT_JSON_NAME,",
    "    model_size=WHISPER_MODEL,",
    ")",
    "print(json.dumps({",
    "    'images': result['imageCount'],",
    "    'audioDurationSeconds': round(result['audioDurationSeconds'], 2),",
    "    'method': result['analysisMethod'],",
    "    'visionDevice': result['clipDevice'],",
    "    'jsonPath': result['outputPath'],",
    "}, indent=2))",
    "import os, pathlib, re, subprocess, sys, threading, time, urllib.request",
    "from pathlib import Path",
    "",
    "RENDER_ROOT = Path(\"/content/gridsplit-colab/local-render\")",
    "RENDER_ROOT.mkdir(parents=True, exist_ok=True)",
    "RENDERER_SOURCE_B64 = " + JSON.stringify(rendererBase64),
    "GATEWAY_SOURCE_B64 = " + JSON.stringify(gatewayBase64),
    "(RENDER_ROOT / \"server.py\").write_bytes(base64.b64decode(RENDERER_SOURCE_B64))",
    "(RENDER_ROOT / \"colab_server.py\").write_bytes(base64.b64decode(GATEWAY_SOURCE_B64))",
    "",
    "cloudflared_url = \"https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64\"",
    "urllib.request.urlretrieve(cloudflared_url, \"/usr/local/bin/cloudflared\")",
    "os.chmod(\"/usr/local/bin/cloudflared\", 0o755)",
    "PORT = 8766",
    "SERVER_PROCESS = subprocess.Popen(",
    "    [sys.executable, str(RENDER_ROOT / \"colab_server.py\"), \"--host\", \"127.0.0.1\", \"--port\", str(PORT)],",
    "    cwd=str(RENDER_ROOT), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,",
    ")",
    "health_request = urllib.request.Request(f\"http://127.0.0.1:{PORT}/v1/health\")",
    "for attempt in range(60):",
    "    if SERVER_PROCESS.poll() is not None:",
    "        raise RuntimeError(\"GridSplit Drive renderer exited during startup.\")",
    "    try:",
    "        with urllib.request.urlopen(health_request, timeout=2) as response:",
    "            health = json.loads(response.read().decode(\"utf-8\"))",
    "        if health.get(\"ready\") is True:",
    "            break",
    "    except Exception:",
    "        time.sleep(1)",
    "else:",
    "    raise RuntimeError(\"GridSplit Drive renderer did not become ready.\")",
    "",
    "TUNNEL_PROCESS = subprocess.Popen(",
    "    [\"/usr/local/bin/cloudflared\", \"tunnel\", \"--url\", f\"http://127.0.0.1:{PORT}\", \"--no-autoupdate\"],",
    "    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1,",
    ")",
    "TUNNEL_READY = threading.Event()",
    "TUNNEL_STATE = {\"url\": None}",
    "def _read_tunnel_output():",
    "    for line in iter(TUNNEL_PROCESS.stdout.readline, \"\"):",
    "        match = re.search(r\"https://[a-z0-9-]+\\.trycloudflare\\.com\", line, re.I)",
    "        if match:",
    "            TUNNEL_STATE[\"url\"] = match.group(0)",
    "            TUNNEL_READY.set()",
    "            return",
    "threading.Thread(target=_read_tunnel_output, daemon=True).start()",
    "if not TUNNEL_READY.wait(120):",
    "    TUNNEL_PROCESS.terminate()",
    "    raise RuntimeError(\"Cloudflare Quick Tunnel did not provide a URL.\")",
    "",
    "GRID_SPLIT_TUNNEL_URL = TUNNEL_STATE[\"url\"]",
    "GPU_NAME = None",
    "try:",
    "    GPU_NAME = subprocess.check_output(",
    "        [\"nvidia-smi\", \"--query-gpu=name\", \"--format=csv,noheader\"],",
    "        text=True, stderr=subprocess.STDOUT,",
    "    ).strip().splitlines()[0]",
    "except Exception:",
    "    pass",
    "print(\"Smart Sync complete:\", result[\"imageCount\"], \"images\")",
    "print(\"Audio duration:\", round(result[\"audioDurationSeconds\"], 2), \"seconds\")",
    "print(\"GPU:\", GPU_NAME or \"Not detected; CPU fallback is available\")",
    "print(\"Colab Quick Tunnel URL:\", GRID_SPLIT_TUNNEL_URL)",
    "print(\"Paste the URL into GridSplit Motion Studio → Google Colab → Test Connection.\")",
    "print(\"Colab reads the original ZIP and WAV from mounted Drive; only the small manifest and settings cross the tunnel.\")",
    "files.download(result[\"outputPath\"])",
  ].join("\n");
  const notebook = {
    cells: [
      notebookCell("markdown", [
        "# GridSplit Smart Sync · Google Drive Analyzer",
        "",
        "This notebook reads the image ZIP and soundtrack directly from your mounted Google Drive. It does not ask you to upload the 1.28 GB ZIP into ChatGPT.",
        "",
        "### Before running",
        "1. Choose Runtime → Change runtime type → T4 GPU when available.",
        "2. Run the cell below and approve Google Drive mounting.",
        "3. Confirm FOLDER_PATH, IMAGE_ZIP_NAME, and AUDIO_FILE_NAME match your Drive files.",
        "4. Wait for Whisper transcription and CLIP image-to-text alignment.",
        "5. Import the downloaded gridsplit-sync.json in Motion Studio. The notebook also starts the live Colab renderer and prints its Quick Tunnel URL; paste that URL into Motion Studio, test the connection, then click Render directly from Google Drive on Colab.",
        "",
        "The analyzer preserves natural filename order, transcribes speech with faster-whisper, compares image frames to timestamped narration windows with CLIP, and constrains matches to chronological order. If no speech is detected, it falls back to even timing and labels that fallback in the JSON.",
        "",
        "The JSON stores relative image filenames, start/end seconds, transcript excerpts, and similarity-based confidence values. The notebook starts a direct Colab renderer; the website sends only the JSON manifest and settings while Colab reads the original ZIP and WAV from mounted Drive."
      ].join("\n")),
      notebookCell("code", setupCode),
    ],
    metadata: {
      colab: { name: "GridSplit_Smart_Sync_Drive_Analyzer.ipynb", provenance: [] },
      kernelspec: { display_name: "Python 3", name: "python3" },
      language_info: { name: "python" },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
  return new Blob([JSON.stringify(notebook, null, 2)], {
    type: "application/x-ipynb+json;charset=utf-8",
  });
}

export function downloadMotionPackage(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
