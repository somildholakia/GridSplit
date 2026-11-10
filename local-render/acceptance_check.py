#!/usr/bin/env python3
"""Run a real local Kokoro + FFmpeg acceptance smoke test for GridSplit.

Start both loopback sidecars first. This script checks the exact browser-origin
CORS/private-network preflights, synthesizes a short WAV through Kokoro, packages
that WAV with a tiny PNG into a valid GridSplit project archive, submits it to
the local renderer, downloads the MP4, and verifies it with ffprobe.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.request
import wave
import zlib
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def http_request(
    url: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    data: bytes | None = None,
    timeout: float = 20,
) -> tuple[int, Any, bytes]:
    request = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.headers, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.headers, error.read()


def get_json(url: str, origin: str, timeout: float = 20) -> tuple[dict[str, Any], Any]:
    status, headers, body = http_request(url, headers={"Origin": origin}, timeout=timeout)
    if status != 200:
        raise RuntimeError(f"GET {url} returned HTTP {status}: {body[:500].decode(errors='replace')}")
    return json.loads(body), headers


def check_private_network_preflight(base_url: str, origin: str, requested_headers: str) -> dict[str, Any]:
    status, headers, body = http_request(
        base_url,
        method="OPTIONS",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": requested_headers,
            "Access-Control-Request-Private-Network": "true",
        },
        timeout=15,
    )
    allow_origin = headers.get("Access-Control-Allow-Origin")
    allow_private = headers.get("Access-Control-Allow-Private-Network")
    allow_methods = {item.strip().upper() for item in headers.get("Access-Control-Allow-Methods", "").split(",")}
    allow_headers = {item.strip().lower() for item in headers.get("Access-Control-Allow-Headers", "").split(",")}
    requested = {item.strip().lower() for item in requested_headers.split(",") if item.strip()}
    missing_headers = sorted(requested - allow_headers)
    if (
        status not in (200, 204)
        or allow_origin != origin
        or allow_private != "true"
        or "POST" not in allow_methods
        or missing_headers
    ):
        raise RuntimeError(
            f"Private-network CORS preflight failed (HTTP {status}, "
            f"allow-origin={allow_origin!r}, allow-private-network={allow_private!r}, "
            f"allow-methods={sorted(allow_methods)!r}, missing-headers={missing_headers!r}): "
            f"{body[:300].decode(errors='replace')}"
        )
    return {
        "status": status, "allow_origin": allow_origin, "private_network": allow_private,
        "allow_methods": sorted(allow_methods), "allow_headers": sorted(allow_headers),
    }


def inspect_wav(data: bytes) -> dict[str, Any]:
    with wave.open(io.BytesIO(data), "rb") as audio:
        channels = audio.getnchannels()
        sample_width = audio.getsampwidth()
        sample_rate = audio.getframerate()
        sample_count = audio.getnframes()
        duration = sample_count / sample_rate if sample_rate else 0
    if not data.startswith(b"RIFF") or not data[8:12] == b"WAVE":
        raise ValueError("Kokoro response is not a RIFF/WAVE file.")
    if channels < 1 or sample_width not in (1, 2, 3, 4) or sample_rate <= 0 or sample_count <= 0:
        raise ValueError("Kokoro returned invalid WAV stream metadata.")
    if not 0.05 <= duration <= 60:
        raise ValueError(f"Kokoro smoke WAV duration is outside the expected range: {duration:.3f}s.")
    return {
        "channels": channels,
        "sample_width_bytes": sample_width,
        "sample_rate": sample_rate,
        "sample_count": sample_count,
        "duration_seconds": round(duration, 4),
        "bytes": len(data),
    }


def png_pixel(red: int = 30, green: int = 90, blue: int = 160) -> bytes:
    def chunk(kind: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload)) + kind + payload
            + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
        )

    header = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    pixels = b"\x00" + bytes((red, green, blue))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(pixels))
        + chunk(b"IEND", b"")
    )


def build_smoke_archive(wav_data: bytes, wav_info: dict[str, Any]) -> tuple[bytes, str]:
    project_id = "gridsplit-local-acceptance"
    image_id = "acceptance-image"
    audio_id = "acceptance-audio"
    block_id = "acceptance-narration"
    scene_id = "acceptance-scene"
    image_path = "media/images/acceptance-image.png"
    audio_path = "media/generated-audio/acceptance-audio.wav"
    image_data = png_pixel()
    duration = max(2.0, float(wav_info["duration_seconds"]) + 0.25)
    project = {
        "id": project_id,
        "name": "GridSplit local media acceptance",
        "scenes": [{
            "id": scene_id,
            "title": "Local acceptance",
            "chapter": "Acceptance",
            "blocks": [{"id": block_id, "kind": "narration", "text": "Local Kokoro smoke test"}],
        }],
        "imageAssets": [{"id": image_id}],
        "audioSegments": [{
            "id": audio_id,
            "sceneId": scene_id,
            "blockId": block_id,
            "status": "ready",
            "sampleCount": wav_info["sample_count"],
            "sampleRate": wav_info["sample_rate"],
            "durationSeconds": wav_info["duration_seconds"],
        }],
        "timelineClips": [
            {
                "id": "acceptance-image-clip", "track": "images", "sceneId": scene_id,
                "assetId": image_id, "startSeconds": 0, "durationSeconds": duration, "order": 0,
            },
            {
                "id": "acceptance-audio-clip", "track": "audio", "sceneId": scene_id,
                "startSeconds": 0, "durationSeconds": wav_info["duration_seconds"], "order": 0,
            },
        ],
        "audioMixTracks": [],
        "mixAssets": [],
        "videoClipEdits": [],
        "renderProfile": {
            "width": 640, "height": 360, "fps": 24,
            "aspectRatio": "16:9", "quality": "compact",
        },
    }
    files = [
        {
            "path": image_path, "kind": "image", "assetId": image_id,
            "mimeType": "image/png", "sizeBytes": len(image_data),
            "sha256": hashlib.sha256(image_data).hexdigest(),
        },
        {
            "path": audio_path, "kind": "generated-audio", "assetId": audio_id,
            "mimeType": "audio/wav", "sizeBytes": len(wav_data),
            "sha256": hashlib.sha256(wav_data).hexdigest(),
        },
    ]
    manifest = {
        "format": "gridsplit-studio-project",
        "version": 1,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "projectId": project_id,
        "files": files,
    }
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
        bundle.writestr("project.json", json.dumps(project))
        bundle.writestr("manifest.json", json.dumps(manifest))
        bundle.writestr(image_path, image_data)
        bundle.writestr(audio_path, wav_data)
    return archive.getvalue(), project_id


def inspect_mp4(data: bytes, ffprobe: str) -> dict[str, Any]:
    if len(data) < 1024 or b"ftyp" not in data[:64]:
        raise ValueError("Renderer download is not a valid MP4 container.")
    import tempfile

    with tempfile.NamedTemporaryFile(suffix=".mp4") as output:
        output.write(data)
        output.flush()
        probe = subprocess.run(
            [
                ffprobe, "-v", "error", "-show_entries",
                "format=duration,format_name:stream=codec_type,codec_name,width,height,r_frame_rate",
                "-of", "json", output.name,
            ],
            capture_output=True, text=True, timeout=60, check=True,
        )
    report = json.loads(probe.stdout)
    streams = report.get("streams", [])
    video = next((item for item in streams if item.get("codec_type") == "video"), None)
    audio = next((item for item in streams if item.get("codec_type") == "audio"), None)
    duration = float(report.get("format", {}).get("duration", 0))
    if not video or video.get("codec_name") != "h264":
        raise ValueError("Rendered MP4 does not contain an H.264 video stream.")
    if not audio or audio.get("codec_name") != "aac":
        raise ValueError("Rendered MP4 does not contain an AAC audio stream.")
    if (video.get("width"), video.get("height")) != (640, 360):
        raise ValueError("Rendered MP4 dimensions differ from the smoke profile.")
    if "mp4" not in report.get("format", {}).get("format_name", "") or duration <= 0:
        raise ValueError("ffprobe did not validate the MP4 container/duration.")
    return {
        "bytes": len(data),
        "duration_seconds": round(duration, 4),
        "width": video["width"],
        "height": video["height"],
        "fps": video.get("r_frame_rate"),
        "video_codec": video["codec_name"],
        "audio_codec": audio["codec_name"],
    }


def run(args: argparse.Namespace) -> dict[str, Any]:
    result: dict[str, Any] = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "origin": args.origin,
        "tts": {"passed": False},
        "renderer": {"passed": False},
        "overall_passed": False,
    }
    artifacts = Path(args.artifacts_dir).resolve()
    artifacts.mkdir(parents=True, exist_ok=True)

    tts_base = args.tts_url.rstrip("/")
    renderer_base = args.renderer_url.rstrip("/")

    try:
        health, health_headers = get_json(tts_base + "/health", args.origin)
        if not health.get("ready"):
            raise RuntimeError(health.get("message") or "Kokoro model is not ready.")
        if health_headers.get("Access-Control-Allow-Origin") != args.origin:
            raise RuntimeError("TTS health response did not allow the configured browser origin.")
        cors = check_private_network_preflight(tts_base + "/synthesize", args.origin, "content-type")
        voices, _ = get_json(tts_base + "/voices", args.origin)
        available = {item.get("id") for item in voices.get("voices", [])}
        if args.voice_id not in available:
            raise RuntimeError(f"Voice {args.voice_id!r} is not available from the local sidecar.")
        status, headers, wav_data = http_request(
            tts_base + "/synthesize",
            method="POST",
            headers={"Origin": args.origin, "Content-Type": "application/json"},
            data=json.dumps({
                "text": args.text,
                "voice_id": args.voice_id,
                "language": args.language,
                "speed": args.speed,
            }).encode("utf-8"),
            timeout=args.synthesis_timeout,
        )
        if status != 200 or not headers.get("Content-Type", "").startswith("audio/wav"):
            raise RuntimeError(f"Kokoro synthesis returned HTTP {status}: {wav_data[:500].decode(errors='replace')}")
        wav_info = inspect_wav(wav_data)
        wav_path = artifacts / "kokoro-acceptance.wav"
        wav_path.write_bytes(wav_data)
        result["tts"] = {
            "passed": True, "health": health, "cors_preflight": cors,
            "voice_id": args.voice_id, "wav": wav_info, "wav_path": str(wav_path),
        }
    except Exception as error:
        result["tts"] = {"passed": False, "error": str(error)}

    try:
        health, health_headers = get_json(renderer_base + "/v1/health", args.origin)
        if not health.get("ready"):
            raise RuntimeError(health.get("message") or "FFmpeg/ffprobe are not ready.")
        if health_headers.get("Access-Control-Allow-Origin") != args.origin:
            raise RuntimeError("Renderer health response did not allow the configured browser origin.")
        cors = check_private_network_preflight(
            renderer_base + "/v1/jobs", args.origin, "content-type,x-gridsplit-project"
        )
        result["renderer"] = {
            "passed": False, "health": health, "cors_preflight": cors,
        }
        if not result["tts"].get("passed"):
            raise RuntimeError("Skipped render upload because real Kokoro synthesis did not pass.")
        archive, project_id = build_smoke_archive(wav_data, wav_info)
        status, _, body = http_request(
            renderer_base + "/v1/jobs",
            method="POST",
            headers={
                "Origin": args.origin,
                "Content-Type": "application/zip",
                "X-GridSplit-Project": project_id,
            },
            data=archive,
            timeout=30,
        )
        if status != 202:
            raise RuntimeError(f"Renderer rejected the smoke archive (HTTP {status}): {body[:500].decode(errors='replace')}")
        job_id = json.loads(body)["id"]
        deadline = time.monotonic() + args.render_timeout
        snapshot: dict[str, Any] = {}
        while time.monotonic() < deadline:
            poll_status, _, poll_body = http_request(
                renderer_base + "/v1/jobs/" + job_id,
                headers={"Origin": args.origin},
                timeout=15,
            )
            if poll_status != 200:
                raise RuntimeError(f"Renderer job polling returned HTTP {poll_status}.")
            snapshot = json.loads(poll_body)
            if snapshot.get("status") not in ("queued", "running"):
                break
            time.sleep(0.5)
        if snapshot.get("status") != "completed":
            raise RuntimeError(
                "Renderer job did not complete: "
                + str(snapshot.get("error") or snapshot.get("message") or snapshot.get("status"))
            )
        download_status, _, mp4_data = http_request(
            renderer_base + "/v1/jobs/" + job_id + "/output",
            headers={"Origin": args.origin},
            timeout=60,
        )
        if download_status != 200:
            raise RuntimeError(f"Renderer MP4 download returned HTTP {download_status}.")
        mp4_info = inspect_mp4(mp4_data, health["ffprobe"])
        mp4_path = artifacts / "kokoro-acceptance.mp4"
        mp4_path.write_bytes(mp4_data)
        result["renderer"] = {
            "passed": True, "health": health, "cors_preflight": cors,
            "job": snapshot, "mp4": mp4_info, "mp4_path": str(mp4_path),
        }
    except Exception as error:
        result["renderer"]["error"] = str(error)

    result["overall_passed"] = bool(
        result["tts"].get("passed") and result["renderer"].get("passed")
    )
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin", default="https://gridsplit-kappa.vercel.app")
    parser.add_argument("--tts-url", default="http://127.0.0.1:8765")
    parser.add_argument("--renderer-url", default="http://127.0.0.1:8766")
    parser.add_argument("--voice-id", default="af_heart")
    parser.add_argument("--language", default="en-us")
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--text", default="This is a local GridSplit audio and video acceptance test.")
    parser.add_argument("--synthesis-timeout", type=float, default=180)
    parser.add_argument("--render-timeout", type=float, default=180)
    parser.add_argument("--artifacts-dir", default="gridsplit-local-acceptance")
    parser.add_argument("--report", default="gridsplit-local-acceptance-report.json")
    args = parser.parse_args()

    report = run(args)
    report_path = Path(args.report).resolve()
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    print(f"Acceptance report: {report_path}")
    return 0 if report["overall_passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
