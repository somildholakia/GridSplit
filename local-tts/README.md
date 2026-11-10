# GridSplit local Kokoro TTS

This optional sidecar supplies offline speech synthesis to GridSplit Studio. The React application remains a static browser app; this process runs on the same computer and listens only on `127.0.0.1`.

## Requirements

- Python 3.10–3.13
- [uv](https://docs.astral.sh/uv/)
- A local copy of the Kokoro ONNX model and matching voice file

## Install

From this directory:

```bash
uv sync
mkdir -p models
```

Download the matching `kokoro-v1.0.onnx` and `voices-v1.0.bin` files from the upstream project yourself and place them in `models/`. See the package's setup guide: https://pypi.org/project/kokoro-onnx/.

GridSplit does not download model weights or voice files and does not redistribute them. The current PyPI page describes `kokoro-onnx` 0.6.1 as MIT licensed and the Kokoro model as Apache-2.0; it requires Python 3.10–3.13. Review each installed phonemizer/runtime/voice dependency and its notices separately before redistribution. See the live voice catalog at https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md.

## Run

```bash
uv run uvicorn server:app --host 127.0.0.1 --port 8765
```

Keep this terminal running. Open **Audio studio** in GridSplit, keep `http://127.0.0.1:8765`, and choose **Test connection**. The service reports missing/invalid model files rather than switching to a remote provider.

## Local API

- `GET /health` — engine and model readiness
- `GET /voices` — available voice choices
- `POST /synthesize` — JSON `{ "text", "voice_id", "language", "speed" }`; returns PCM WAV

Only loopback browser origins are allowed by CORS. Do not expose this server to a LAN or public network. The default command binds to loopback. There is no authentication because the service is explicitly local-only.

## Limits

- Individual blocks are limited to 5,000 characters.
- SFX/music cue blocks are not sent through TTS.
- Duration is derived from WAV sample count and sample rate. Word-level alignment is not claimed.
- This sidecar is optional; script editing and voice assignment work without the Python runtime or model files.
