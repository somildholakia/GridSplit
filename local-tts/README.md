# GridSplit local Kokoro TTS

This optional sidecar supplies offline speech synthesis to GridSplit Studio. The React application remains a static browser app; this process runs on the same computer and listens only on `127.0.0.1`.

## Requirements

- Python 3.10–3.13
- [uv](https://docs.astral.sh/uv/) 0.13.5 or newer
- A local copy of the Kokoro ONNX model and matching voice file

## Install

From this directory:

```bash
uv sync --locked --no-dev
mkdir -p models
```

Download the matching `kokoro-v1.0.onnx` and `voices-v1.0.bin` files from the upstream project yourself and place them in `models/`. See the package's setup guide: https://pypi.org/project/kokoro-onnx/.

The Python dependency graph is resolved with a pinned uv toolchain in CI and audited with `pip-audit`. The audit tool is a development-only dependency; normal sidecar installs use `--no-dev`. Model and voice assets remain separate user-installed files and are not included in the Python lock.

GridSplit does not download model weights or voice files and does not redistribute them. The current PyPI page describes `kokoro-onnx` 0.6.1 as MIT licensed and the Kokoro model as Apache-2.0; it requires Python 3.10–3.13. Review each installed phonemizer/runtime/voice dependency and its notices separately before redistribution. See the live voice catalog at https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md.

## Run

```bash
uv run --no-sync uvicorn server:app --host 127.0.0.1 --port 8765
```

Keep this terminal running. Open **Audio studio** in GridSplit, keep `http://127.0.0.1:8765`, and choose **Test connection**. The service reports missing/invalid model files rather than switching to a remote provider.

## Use the deployed GridSplit website

The frontend may be served from Vercel while synthesis remains on your own computer. The TTS process must still bind to `127.0.0.1`; add the **exact** production origin to its CORS allowlist before starting it.

Windows PowerShell:

```powershell
$env:GRIDSPLIT_ALLOWED_ORIGINS = "https://gridsplit-kappa.vercel.app"
uv run --no-sync uvicorn server:app --host 127.0.0.1 --port 8765
```

macOS/Linux:

```bash
GRIDSPLIT_ALLOWED_ORIGINS=https://gridsplit-kappa.vercel.app uv run --no-sync uvicorn server:app --host 127.0.0.1 --port 8765
```

For local development, the localhost origins are already allowed by the sidecar. Never use a wildcard origin or expose the TTS server to your LAN. In the public website, keep the Audio Studio endpoint at `http://127.0.0.1:8765`.

## Local API

- `GET /health` — engine and model readiness
- `GET /voices` — available voice choices
- `POST /synthesize` — JSON `{ "text", "voice_id", "language", "speed" }`; returns PCM WAV

Local development origins are allowed by default. To use a separately hosted static frontend, configure its exact HTTPS origin before starting the sidecar:

```bash
GRIDSPLIT_ALLOWED_ORIGINS=https://your-exact-gridsplit-domain.example uv run --no-sync uvicorn server:app --host 127.0.0.1 --port 8765
```

Do not use wildcard origins or expose this server to a LAN/public network. The process must remain bound to loopback. The sidecar also validates the HTTP Host header and rejects names other than `localhost`, `127.0.0.1` or `[::1]` (with an optional port). There is no authentication because this is a same-device workflow; this service must never be exposed to a LAN/public network. The service acknowledges browser private-network preflight only for those permitted origins.

## Limits

- Individual blocks are limited to 5,000 characters.
- SFX/music cue blocks are not sent through TTS.
- Duration is derived from WAV sample count and sample rate. Word-level alignment is not claimed.
- This sidecar is optional; script editing and voice assignment work without the Python runtime or model files.


## Security regression tests

From this directory, run:

```bash
python -m unittest discover -s . -p 'test_*.py'
```

The tests cover accepted loopback Host forms and reject remote, ambiguous and malformed Host values. The GitHub workflow runs this suite alongside renderer integration tests.
