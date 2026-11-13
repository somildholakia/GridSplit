import rendererSource from "../../../local-render/server.py?raw";
import gatewaySource from "../../../local-render/colab_server.py?raw";

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
    "GRID_SPLIT_TOKEN = secrets.token_urlsafe(48)",
    "os.environ['GRID_SPLIT_COLAB_TOKEN'] = GRID_SPLIT_TOKEN",
    "PORT = 8766",
    "SERVER_PROCESS = subprocess.Popen(",
    "    [sys.executable, str(RENDER_ROOT / 'colab_server.py'), '--host', '127.0.0.1', '--port', str(PORT)],",
    "    cwd=str(RENDER_ROOT), env=os.environ.copy(), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,",
    ")",
    "",
    "# Wait until the authenticated local API is actually healthy before tunnelling it.",
    "health_request = urllib.request.Request(",
    "    f'http://127.0.0.1:{PORT}/v1/health',",
    "    headers={'X-GridSplit-Token': GRID_SPLIT_TOKEN},",
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
    "    raise RuntimeError('The authenticated GridSplit renderer did not become ready.')",
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
    "print('Secure connection token:', GRID_SPLIT_TOKEN)",
    "print('Paste the URL and token into Motion Studio → Render on Google Colab.')",
    "print('Keep this Colab runtime running while GridSplit uploads and renders your project.')",
  ].join("\n");

  const notebook = {
    cells: [
      notebookCell("markdown", [
        "# GridSplit Motion Studio · Live Colab Renderer",
        "",
        "This notebook starts the **same FFmpeg renderer used by GridSplit's local rendering option** behind an authenticated Cloudflare Quick Tunnel.",
        "",
        "1. In Colab, choose **Runtime → Change runtime type → T4 GPU** when available.",
        "2. Run the notebook cells from top to bottom.",
        "3. Copy the displayed Quick Tunnel URL and secure token into GridSplit → Motion Studio → Render on Google Colab.",
        "4. Test the connection, then start a render. GridSplit uploads the portable project archive in retryable chunks and downloads the validated MP4 in byte ranges.",
        "",
        "The notebook creates a random token for this runtime. It is not stored in the notebook or repository. The renderer binds to loopback only; only Cloudflare's tunnel exposes it. No AI API key or paid rendering service is used.",
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

export function downloadMotionPackage(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
