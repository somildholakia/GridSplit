"""Optional loopback-only Kokoro ONNX service for GridSplit Studio.
Model and voice files are user-installed; this service never downloads them.
"""
from __future__ import annotations

import io
import os
from pathlib import Path
from typing import Any

import soundfile as sf
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent
MODEL_PATH = Path(os.environ.get("KOKORO_MODEL_PATH", ROOT / "models" / "kokoro-v1.0.onnx"))
VOICES_PATH = Path(os.environ.get("KOKORO_VOICES_PATH", ROOT / "models" / "voices-v1.0.bin"))
MAX_TEXT_LENGTH = 5000
VOICE_CATALOG = [
    {"id":"af_heart","name":"Heart","language":"en-us","languageName":"American English"},
    {"id":"af_bella","name":"Bella","language":"en-us","languageName":"American English"},
    {"id":"af_sarah","name":"Sarah","language":"en-us","languageName":"American English"},
    {"id":"af_nicole","name":"Nicole","language":"en-us","languageName":"American English"},
    {"id":"am_michael","name":"Michael","language":"en-us","languageName":"American English"},
    {"id":"am_adam","name":"Adam","language":"en-us","languageName":"American English"},
    {"id":"bf_emma","name":"Emma","language":"en-gb","languageName":"British English"},
    {"id":"bm_george","name":"George","language":"en-gb","languageName":"British English"},
]

app = FastAPI(title="GridSplit Local TTS", docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$",
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)
engine: Any = None
engine_error: str | None = None


class SynthesisRequest(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TEXT_LENGTH)
    voice_id: str = Field(min_length=1, max_length=80)
    language: str = Field(default="en-us", min_length=2, max_length=12)
    speed: float = Field(default=1.0, ge=0.5, le=2.0)


@app.on_event("startup")
def load_engine() -> None:
    global engine, engine_error
    if not MODEL_PATH.is_file() or not VOICES_PATH.is_file():
        engine_error = (
            "Model files are missing. Place kokoro-v1.0.onnx and voices-v1.0.bin "
            "inside local-tts/models, then restart the service."
        )
        return
    try:
        from kokoro_onnx import Kokoro
        engine = Kokoro(str(MODEL_PATH), str(VOICES_PATH))
        engine_error = None
    except Exception as exc:
        engine = None
        engine_error = f"Could not load Kokoro ONNX: {exc}"


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ready": engine is not None, "engine": "Kokoro ONNX",
            "model": MODEL_PATH.name if MODEL_PATH.is_file() else None,
            "message": engine_error or "Local model is ready."}


@app.get("/voices")
def voices() -> dict[str, Any]:
    if engine is None:
        raise HTTPException(status_code=503, detail=engine_error or "The local model is not ready.")
    return {"voices": VOICE_CATALOG}


@app.post("/synthesize")
def synthesize(request: SynthesisRequest) -> Response:
    if engine is None:
        raise HTTPException(status_code=503, detail=engine_error or "The local model is not ready.")
    try:
        samples, sample_rate = engine.create(
            request.text.strip(), voice=request.voice_id,
            speed=request.speed, lang=request.language,
        )
        if len(samples) == 0 or int(sample_rate) <= 0:
            raise ValueError("The model returned no audio samples.")
        buffer = io.BytesIO()
        sf.write(buffer, samples, int(sample_rate), format="WAV", subtype="PCM_16")
        return Response(content=buffer.getvalue(), media_type="audio/wav",
                        headers={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"})
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Kokoro synthesis failed: {exc}") from exc
