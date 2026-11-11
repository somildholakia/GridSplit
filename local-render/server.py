#!/usr/bin/env python3
"""Loopback-only FFmpeg renderer for GridSplit Studio. No media is sent to a cloud service."""
from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import os
import shutil
import signal
import subprocess
import tempfile
import threading
import time
import uuid
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath

MAX_ARCHIVE = 1024 * 1024 * 1024
MAX_EXPANDED = 2 * 1024 * 1024 * 1024
MAX_MEDIA_FILES = 5_000
MAX_ENTRIES = MAX_MEDIA_FILES + 2  # manifest.json and project.json
MAX_ACTIVE_JOBS = 2
MAX_FINISHED_JOBS = 8
JOB_RETENTION_SECONDS = 6 * 60 * 60
JOBS: dict[str, dict] = {}
JOBS_LOCK = threading.RLock()
ALLOWED_ORIGINS: set[str] = set()


def prune_finished_jobs(now: float | None = None) -> None:
    """Bound completed-job metadata and remove expired render temp directories."""
    current = time.time() if now is None else now
    with JOBS_LOCK:
        finished = [
            (job_id, job)
            for job_id, job in JOBS.items()
            if job.get("status") in ("completed", "failed", "cancelled")
        ]
        finished.sort(key=lambda item: float(item[1].get("finishedAt", item[1].get("createdAt", 0))))
        expired = {
            job_id for job_id, job in finished
            if current - float(job.get("finishedAt", job.get("createdAt", current))) > JOB_RETENTION_SECONDS
        }
        retained = [job_id for job_id, _ in finished if job_id not in expired]
        overflow = set(retained[:max(0, len(retained) - MAX_FINISHED_JOBS)])
        directories = []
        for job_id in expired | overflow:
            job = JOBS.pop(job_id, None)
            if job:
                directory = Path(str(job.get("directory", ""))).parent
                if directory.name.startswith("gridsplit-render-"):
                    directories.append(directory)
    for directory in directories:
        shutil.rmtree(directory, ignore_errors=True)


def safe_path(name: str) -> PurePosixPath:
    path = PurePosixPath(name)
    if path.is_absolute() or not path.parts or any(part in ("", ".", "..") for part in path.parts):
        raise ValueError("Unsafe archive path.")
    if "\\" in name or ":" in name:
        raise ValueError("Unsafe archive path.")
    return path


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def extract_verified_archive(archive: Path, destination: Path) -> tuple[dict, dict]:
    if archive.stat().st_size > MAX_ARCHIVE:
        raise ValueError("Archive exceeds the 1 GB compressed limit.")
    with zipfile.ZipFile(archive) as bundle:
        infos = bundle.infolist()
        if len(infos) > MAX_ENTRIES:
            raise ValueError("Archive contains too many entries.")
        expanded = sum(item.file_size for item in infos)
        if expanded > MAX_EXPANDED:
            raise ValueError("Archive exceeds the 2 GB uncompressed limit.")
        for item in infos:
            safe_path(item.filename)
            unix_mode = (item.external_attr >> 16) & 0o170000
            if unix_mode == 0o120000:
                raise ValueError("Symbolic links are not allowed in project archives.")
            if item.file_size > 0 and item.compress_size == 0:
                raise ValueError("Invalid compressed media entry.")
            if item.compress_size and item.file_size / item.compress_size > 1000:
                raise ValueError("Archive contains an excessive compression ratio.")
        for name in ("manifest.json", "project.json"):
            if name not in bundle.namelist():
                raise ValueError("Archive is missing " + name + ".")
        manifest = json.loads(bundle.read("manifest.json"))
        project = json.loads(bundle.read("project.json"))
        if manifest.get("format") != "gridsplit-studio-project" or manifest.get("version") != 1:
            raise ValueError("Unsupported GridSplit archive format.")
        if not isinstance(project, dict) or project.get("id") != manifest.get("projectId"):
            raise ValueError("Project metadata does not match the archive manifest.")
        records = manifest.get("files")
        if not isinstance(records, list) or len(records) > MAX_MEDIA_FILES:
            raise ValueError("Invalid media manifest.")
        seen: set[str] = set()
        for record in records:
            if not isinstance(record, dict):
                raise ValueError("Invalid media manifest entry.")
            name = record.get("path")
            rel = safe_path(name if isinstance(name, str) else "")
            if len(rel.parts) != 3 or rel.parts[0] != "media" or rel.parts[1] not in ("images", "generated-audio", "mix-audio"):
                raise ValueError("Unexpected media path in manifest.")
            if name in seen:
                raise ValueError("Duplicate media path in manifest.")
            seen.add(name)
            info = bundle.getinfo(name)
            if info.is_dir() or info.file_size != record.get("sizeBytes"):
                raise ValueError("Media size does not match the manifest.")
            target = destination.joinpath(*rel.parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            with bundle.open(info) as source, target.open("wb") as output:
                shutil.copyfileobj(source, output, 1024 * 1024)
            if sha256_file(target) != record.get("sha256"):
                raise ValueError("SHA-256 verification failed for " + name + ".")
            if not isinstance(record.get("assetId"), str):
                raise ValueError("Invalid media asset ID.")
        return manifest, project


def clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def render_command(project: dict, manifest: dict, root: Path) -> tuple[list[str], float, dict]:
    ffmpeg = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")
    if not ffmpeg or not ffprobe:
        raise RuntimeError("FFmpeg and ffprobe must both be installed and available in PATH on this computer.")
    profile = project.get("renderProfile") or {
        "width": 1920, "height": 1080, "fps": 30, "aspectRatio": "16:9", "quality": "balanced"
    }
    width, height = int(profile.get("width", 1920)), int(profile.get("height", 1080))
    fps = float(profile.get("fps", 30))
    if not (320 <= width <= 3840 and 320 <= height <= 3840 and width % 2 == 0 and height % 2 == 0):
        raise ValueError("Output dimensions must be even and between 320 and 3840 pixels.")
    if fps not in (23.976, 24, 25, 29.97, 30, 50, 59.94, 60):
        raise ValueError("Unsupported frame rate.")
    ratio = profile.get("aspectRatio", "16:9")
    expected = {"16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1}.get(ratio)
    if expected is None or abs(width / height - expected) > 0.015:
        raise ValueError("Render profile aspect ratio does not match its dimensions.")

    by_id = {item.get("assetId"): item for item in manifest.get("files", [])}
    images = {item.get("id"): item for item in project.get("imageAssets", []) if isinstance(item, dict)}
    raw_clips = [item for item in project.get("timelineClips", []) if item.get("track") == "images"]
    raw_clips.sort(key=lambda item: (float(item.get("startSeconds", 0)), int(item.get("order", 0))))
    if not raw_clips:
        raise ValueError("The project has no image clips to render.")

    parts: list[dict] = []
    cursor = 0.0
    for clip in raw_clips:
        start = float(clip.get("startSeconds", 0))
        duration = float(clip.get("durationSeconds", 0))
        asset_id = clip.get("assetId")
        record = by_id.get(asset_id)
        asset = images.get(asset_id)
        if not record or record.get("kind") != "image" or not asset:
            raise ValueError("An image timeline clip is missing its packaged source.")
        if not (0 <= start < 86400 and 0 < duration <= 86400):
            raise ValueError("An image clip contains invalid timing.")
        if start > cursor + 0.05:
            parts.append({"kind": "black", "duration": start - cursor, "edit": {}})
            cursor = start
        trim_before = max(0.0, cursor - start)
        effective_duration = duration - trim_before
        if effective_duration <= 0.001:
            continue
        parts.append({
            "kind": "image",
            "path": root / record["path"],
            "duration": effective_duration,
            "edit": next((item for item in project.get("videoClipEdits", []) if item.get("clipId") == clip.get("id")), {}),
        })
        cursor = max(cursor, start + duration)
    video_duration = cursor
    if video_duration <= 0:
        raise ValueError("The image timeline has no renderable duration.")

    command = [ffmpeg, "-hide_banner", "-y", "-loglevel", "warning", "-progress", "pipe:1", "-nostats"]
    filters: list[str] = []
    stream_labels: list[str] = []
    input_index = 0
    for index, part in enumerate(parts):
        duration = part["duration"]
        if part["kind"] == "black":
            command += ["-f", "lavfi", "-i", f"color=c=black:s={width}x{height}:r={fps}:d={duration:.6f}"]
            filters.append(f"[{input_index}:v]trim=duration={duration:.6f},setpts=PTS-STARTPTS,format=yuv420p,setsar=1[v{index}]")
        else:
            command += ["-loop", "1", "-framerate", str(fps), "-t", f"{duration:.6f}", "-i", str(part["path"])]
            edit = part["edit"]
            effect = edit.get("effect", "none")
            zoom = clamp(float(edit.get("zoom", 1.12)), 1.0, 1.5)
            base = f"[{input_index}:v]scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},setsar=1,fps={fps},trim=duration={duration:.6f},setpts=PTS-STARTPTS"
            if effect in ("ken-burns", "zoom-in", "zoom-out", "pan-left", "pan-right"):
                max_zoom = zoom if effect != "ken-burns" else max(zoom, 1.12)
                frames = max(1, int(duration * fps))
                if effect == "zoom-out":
                    z = f"max(1.0,{max_zoom:.5f}-on*{(max_zoom - 1.0) / frames:.8f})"
                else:
                    z = f"min(zoom+{(max_zoom - 1.0) / frames:.8f},{max_zoom:.5f})"
                x = f"(iw-iw/zoom)*on/{frames}" if effect == "pan-right" else (
                    f"(iw-iw/zoom)*(1-on/{frames})" if effect == "pan-left" else "iw/2-(iw/zoom/2)"
                )
                base += f",zoompan=z='{z}':x='{x}':y='ih/2-(ih/zoom/2)':d=1:s={width}x{height}:fps={fps}"
            filters.append(base + f",trim=duration={duration:.6f},setpts=PTS-STARTPTS,format=yuv420p[v{index}]")
        stream_labels.append(f"[v{index}]")
        input_index += 1

    current = stream_labels[0]
    running_duration = parts[0]["duration"]
    transition_extra = 0.0
    for index in range(1, len(parts)):
        label = f"[vx{index}]"
        current_edit = parts[index]["edit"]
        previous_edit = parts[index - 1]["edit"]
        transition = current_edit.get("transitionIn", "cut")
        if transition == "cut":
            transition = previous_edit.get("transitionOut", "cut")
        transition_name = {
            "fade": "fade", "dissolve": "dissolve", "wipe-left": "wipeleft", "wipe-right": "wiperight"
        }.get(transition)
        if transition_name:
            requested = float(current_edit.get("transitionDurationSeconds", previous_edit.get("transitionDurationSeconds", 0.5)))
            fade = clamp(requested, 0.05, min(5.0, parts[index]["duration"] / 2, running_duration / 2))
            offset = max(0.0, running_duration - fade)
            filters.append(f"{current}{stream_labels[index]}xfade=transition={transition_name}:duration={fade:.6f}:offset={offset:.6f}{label}")
            transition_extra += fade
            running_duration += parts[index]["duration"] - fade
        else:
            filters.append(f"{current}{stream_labels[index]}concat=n=2:v=1:a=0{label}")
            running_duration += parts[index]["duration"]
        current = label
    if transition_extra > 0:
        filters.append(f"{current}tpad=stop_mode=clone:stop_duration={transition_extra:.6f},trim=duration={video_duration:.6f},setpts=PTS-STARTPTS[vout]")
    else:
        filters.append(f"{current}trim=duration={video_duration:.6f},setpts=PTS-STARTPTS[vout]")

    tracks = project.get("audioMixTracks", [])
    if not isinstance(tracks, list):
        tracks = []
    defaults = [
        {"id": "default-narration", "kind": "narration", "volume": 1, "muted": False, "solo": False, "fadeInSeconds": 0, "fadeOutSeconds": 0},
        {"id": "default-dialogue", "kind": "dialogue", "volume": 1, "muted": False, "solo": False, "fadeInSeconds": 0, "fadeOutSeconds": 0},
        {"id": "default-music", "kind": "music", "volume": 0.35, "muted": False, "solo": False, "fadeInSeconds": 1, "fadeOutSeconds": 2},
        {"id": "default-sfx", "kind": "sfx", "volume": 0.8, "muted": False, "solo": False, "fadeInSeconds": 0, "fadeOutSeconds": 0},
    ]
    by_kind = {item.get("kind"): item for item in tracks if isinstance(item, dict)}
    by_kind = {**{item["kind"]: item for item in defaults}, **by_kind}
    solo_active = any(item.get("solo") and not item.get("muted") for item in by_kind.values())
    enabled = {
        item.get("id") for item in by_kind.values()
        if not item.get("muted") and (not solo_active or item.get("solo"))
    }
    mix_tracks = {item.get("id"): item for item in by_kind.values()}

    scene_order = {scene.get("id"): index for index, scene in enumerate(project.get("scenes", []))}
    audio_clips = {
        clip.get("sceneId"): clip for clip in project.get("timelineClips", [])
        if clip.get("track") == "audio"
    }
    files_by_id = {item.get("assetId"): item for item in manifest.get("files", [])}
    audio_events: list[dict] = []
    offsets: dict[str, float] = {}
    segments = sorted(
        [item for item in project.get("audioSegments", []) if item.get("status") == "ready"],
        key=lambda item: (scene_order.get(item.get("sceneId"), 999999),
                          next((i for i, block in enumerate(next((s.get("blocks", []) for s in project.get("scenes", []) if s.get("id") == item.get("sceneId")), [])) if block.get("id") == item.get("blockId")), 999999)),
    )
    for segment in segments:
        record = files_by_id.get(segment.get("id"))
        scene_id = segment.get("sceneId")
        scene = next((item for item in project.get("scenes", []) if item.get("id") == scene_id), {})
        block = next((item for item in scene.get("blocks", []) if item.get("id") == segment.get("blockId")), {})
        kind = "dialogue" if block.get("kind") == "dialogue" else "narration"
        track = next((item for item in by_kind.values() if item.get("kind") == kind), defaults[0 if kind == "narration" else 1])
        if not record or record.get("kind") != "generated-audio" or track.get("id") not in enabled:
            continue
        clip = audio_clips.get(scene_id, {})
        duration = float(segment.get("sampleCount", 0)) / float(segment.get("sampleRate", 1))
        if duration <= 0:
            duration = float(segment.get("durationSeconds", 0))
        start = float(clip.get("startSeconds", 0)) + offsets.get(scene_id, 0)
        offsets[scene_id] = offsets.get(scene_id, 0) + duration
        audio_events.append({"path": root / record["path"], "start": start, "duration": duration, "track": track})

    for asset in project.get("mixAssets", []):
        if not isinstance(asset, dict):
            continue
        track = mix_tracks.get(asset.get("trackId"))
        record = files_by_id.get(asset.get("id"))
        if track and track.get("id") in enabled and record and record.get("kind") == "mix-audio":
            audio_events.append({
                "path": root / record["path"],
                "start": float(asset.get("startSeconds", 0)),
                "duration": min(float(asset.get("durationSeconds", video_duration)), video_duration),
                "track": track,
            })

    audio_indices: list[str] = []
    for event in audio_events:
        if event["start"] >= video_duration or event["duration"] <= 0:
            continue
        command += ["-i", str(event["path"])]
        index = input_index
        input_index += 1
        duration = min(event["duration"], video_duration - event["start"])
        track = event["track"]
        gain = clamp(float(track.get("volume", 1)), 0, 2)
        fade_in = clamp(float(track.get("fadeInSeconds", 0)), 0, duration)
        fade_out = clamp(float(track.get("fadeOutSeconds", 0)), 0, duration)
        delay = max(0, int(event["start"] * 1000))
        label = f"[a{len(audio_indices)}]"
        audio_chain = [
            f"atrim=duration={duration:.6f}",
            "asetpts=PTS-STARTPTS",
            f"volume={gain:.4f}",
        ]
        if fade_in > 0:
            audio_chain.append(f"afade=t=in:st=0:d={fade_in:.6f}")
        if fade_out > 0:
            audio_chain.append(f"afade=t=out:st={max(0, duration - fade_out):.6f}:d={fade_out:.6f}")
        audio_chain.append(f"adelay={delay}|{delay}:all=1")
        filters.append(f"[{index}:a]{','.join(audio_chain)}{label}")
        audio_indices.append(label)

    if audio_indices:
        joined = "".join(audio_indices)
        filters.append(f"{joined}amix=inputs={len(audio_indices)}:duration=longest:dropout_transition=0,alimiter=limit=0.97,atrim=duration={video_duration:.6f}[aout]")
    else:
        command += ["-f", "lavfi", "-t", f"{video_duration:.6f}", "-i", "anullsrc=r=48000:cl=stereo"]
        filters.append(f"[{input_index}:a]atrim=duration={video_duration:.6f},asetpts=PTS-STARTPTS[aout]")

    command += [
        "-filter_complex", ";".join(filters),
        "-map", "[vout]", "-map", "[aout]",
        "-t", f"{video_duration:.6f}",
        "-r", str(fps), "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-preset", "medium",
        "-crf", {"high": "18", "balanced": "21", "compact": "26"}.get(profile.get("quality"), "21"),
        "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
        str(root / "output.mp4"),
    ]
    return command, video_duration, {"width": width, "height": height, "fps": fps, "ffprobe": ffprobe}


def execute_job(job_id: str) -> None:
    with JOBS_LOCK:
        job = JOBS[job_id]
        job["status"] = "running"
        job["progress"] = 2
        job["message"] = "Validating the local render environment and project media."
    try:
        root = Path(job["directory"])
        command, duration, profile = render_command(job["project"], job["manifest"], root)
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
        with JOBS_LOCK:
            job["process"] = process
            job["message"] = "FFmpeg is rendering locally."
        if process.stdout:
            for line in process.stdout:
                if job["cancel"].is_set():
                    process.terminate()
                    break
                line = line.strip()
                if line.startswith("out_time_ms="):
                    try:
                        seconds = int(line.split("=", 1)[1]) / 1_000_000
                        progress = min(94, max(2, int(seconds / duration * 92)))
                        with JOBS_LOCK:
                            job["progress"] = progress
                    except (ValueError, ZeroDivisionError):
                        pass
                elif line.startswith("progress=end"):
                    with JOBS_LOCK:
                        job["progress"] = 95
                elif line:
                    with JOBS_LOCK:
                        job["lastLog"] = (job.get("lastLog", "") + line + "\\n")[-4000:]
        return_code = process.wait()
        if job["cancel"].is_set():
            with JOBS_LOCK:
                job["status"] = "cancelled"
                job["message"] = "Render was cancelled."
            return
        if return_code != 0:
            raise RuntimeError("FFmpeg failed. Check the imported audio formats and local codec support. " + (job.get("lastLog", "")[-1200:]))
        output = root / "output.mp4"
        if not output.is_file() or output.stat().st_size < 1024:
            raise RuntimeError("FFmpeg completed without producing a valid MP4 output.")
        probe = subprocess.run(
            [profile["ffprobe"], "-v", "error", "-show_entries",
             "format=duration,format_name:stream=codec_type,codec_name,width,height,r_frame_rate",
             "-of", "json", str(output)],
            capture_output=True, text=True, timeout=60, check=True,
        )
        report = json.loads(probe.stdout)
        streams = report.get("streams", [])
        video = next((item for item in streams if item.get("codec_type") == "video"), None)
        audio = next((item for item in streams if item.get("codec_type") == "audio"), None)
        actual_duration = float(report.get("format", {}).get("duration", 0))
        if not video or not audio or video.get("codec_name") != "h264" or audio.get("codec_name") != "aac":
            raise RuntimeError("Output validation failed: expected H.264 video and AAC audio streams.")
        if "mp4" not in report.get("format", {}).get("format_name", ""):
            raise RuntimeError("Output validation failed: the container is not MP4.")
        try:
            rate_parts = str(video.get("r_frame_rate", "0/1")).split("/")
            actual_fps = float(rate_parts[0]) / float(rate_parts[1])
        except (ValueError, ZeroDivisionError):
            actual_fps = 0.0
        if abs(actual_fps - profile["fps"]) > 0.02:
            raise RuntimeError("Output validation failed: frame rate does not match the selected profile.")
        if int(video.get("width", 0)) != profile["width"] or int(video.get("height", 0)) != profile["height"]:
            raise RuntimeError("Output validation failed: rendered dimensions do not match the selected profile.")
        if abs(actual_duration - duration) > max(0.25, 2 / profile["fps"]):
            raise RuntimeError("Output validation failed: MP4 duration differs from the timeline.")
        with JOBS_LOCK:
            job["status"] = "completed"
            job["progress"] = 100
            job["message"] = "MP4 validated by ffprobe: H.264, AAC, dimensions, frame rate and duration."
            job["output"] = {
                "filename": "output.mp4", "bytes": output.stat().st_size,
                "durationSeconds": actual_duration, "width": profile["width"],
                "height": profile["height"], "fps": profile["fps"],
                "videoCodec": "h264", "audioCodec": "aac",
            }
    except Exception as error:
        with JOBS_LOCK:
            if job["cancel"].is_set():
                job["status"] = "cancelled"
                job["message"] = "Render was cancelled."
            else:
                job["status"] = "failed"
                job["error"] = str(error)
                job["message"] = "Local render failed."
    finally:
        with JOBS_LOCK:
            process = job.get("process")
            if process and process.poll() is None:
                process.kill()
            job.pop("process", None)
            if job.get("status") in ("completed", "failed", "cancelled"):
                job["finishedAt"] = time.time()


class Handler(BaseHTTPRequestHandler):
    server_version = "GridSplitLocalRenderer/1.0"

    def log_message(self, fmt: str, *args) -> None:
        print("[GridSplit renderer] " + fmt % args, flush=True)

    def _origin(self) -> str | None:
        return self.headers.get("Origin")

    def _host_allowed(self) -> bool:
        host = self.headers.get("Host", "").split(":", 1)[0].strip("[]").lower()
        return host in ("127.0.0.1", "localhost", "::1")

    def _cors(self) -> None:
        origin = self._origin()
        if origin and origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-GridSplit-Project")
            if self.headers.get("Access-Control-Request-Private-Network") == "true":
                self.send_header("Access-Control-Allow-Private-Network", "true")

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _check_request(self) -> bool:
        if not self._host_allowed():
            self._json(403, {"error": "Host header rejected. Use the loopback renderer address."})
            return False
        origin = self._origin()
        if origin and origin not in ALLOWED_ORIGINS:
            self._json(403, {"error": "This browser origin is not on the renderer allowlist. Restart with --allow-origin for this exact origin."})
            return False
        return True

    def do_OPTIONS(self) -> None:
        if not self._check_request():
            return
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:
        if not self._check_request():
            return
        prune_finished_jobs()
        if self.path == "/v1/health":
            self._json(200, {"ready": bool(shutil.which("ffmpeg") and shutil.which("ffprobe")),
                             "ffmpeg": shutil.which("ffmpeg"), "ffprobe": shutil.which("ffprobe"),
                             "message": "Renderer runs only on this computer."})
            return
        pieces = self.path.strip("/").split("/")
        if len(pieces) >= 3 and pieces[:2] == ["v1", "jobs"]:
            job_id = pieces[2]
            with JOBS_LOCK:
                job = JOBS.get(job_id)
                if not job:
                    self._json(404, {"error": "Render job not found."})
                    return
                snapshot = {key: job.get(key) for key in ("id", "status", "progress", "message", "error", "output")}
            if len(pieces) == 4 and pieces[3] == "output":
                if snapshot["status"] != "completed":
                    self._json(409, {"error": "Render output is not ready."})
                    return
                output = Path(job["directory"]) / "output.mp4"
                self.send_response(200)
                self.send_header("Content-Type", "video/mp4")
                self.send_header("Content-Length", str(output.stat().st_size))
                self._cors()
                self.end_headers()
                with output.open("rb") as handle:
                    shutil.copyfileobj(handle, self.wfile)
                return
            self._json(200, snapshot)
            return
        self._json(404, {"error": "Route not found."})

    def do_POST(self) -> None:
        if not self._check_request():
            return
        prune_finished_jobs()
        if self.path != "/v1/jobs":
            self._json(404, {"error": "Route not found."})
            return
        with JOBS_LOCK:
            active_count = sum(job.get("status") in ("queued", "running") for job in JOBS.values())
        if active_count >= MAX_ACTIVE_JOBS:
            self._json(429, {"error": "The local renderer is already running its maximum of two jobs. Wait for one to finish."})
            return
        directory: Path | None = None
        registered = False
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_ARCHIVE:
                raise ValueError("Upload must be a non-empty project ZIP under 1 GB.")
            if not self.headers.get("Content-Type", "").startswith("application/zip"):
                raise ValueError("Upload must use application/zip content type.")
            project_id = self.headers.get("X-GridSplit-Project", "")
            directory = Path(tempfile.mkdtemp(prefix="gridsplit-render-"))
            archive = directory / "project.zip"
            remaining = length
            with archive.open("wb") as handle:
                while remaining:
                    chunk = self.rfile.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise ValueError("Upload ended before the declared content length.")
                    handle.write(chunk)
                    remaining -= len(chunk)
            manifest, project = extract_verified_archive(archive, directory / "project")
            if project_id and project_id != manifest.get("projectId"):
                raise ValueError("Project ID header does not match the archive.")
            job_id = uuid.uuid4().hex
            job = {
                "id": job_id, "status": "queued", "progress": 0, "message": "Project archive accepted.",
                "error": None, "output": None, "directory": str(directory / "project"),
                "manifest": manifest, "project": project, "cancel": threading.Event(), "process": None,
                "createdAt": time.time(),
            }
            with JOBS_LOCK:
                active_count = sum(item.get("status") in ("queued", "running") for item in JOBS.values())
                if active_count >= MAX_ACTIVE_JOBS:
                    raise RuntimeError("The local renderer is already running its maximum of two jobs. Wait for one to finish.")
                JOBS[job_id] = job
                registered = True
            worker = threading.Thread(target=execute_job, args=(job_id,), daemon=True)
            worker.start()
            self._json(202, {key: job.get(key) for key in ("id", "status", "progress", "message")})
        except Exception as error:
            if directory is not None and not registered:
                shutil.rmtree(directory, ignore_errors=True)
            self._json(400, {"error": str(error)})

    def do_DELETE(self) -> None:
        if not self._check_request():
            return
        pieces = self.path.strip("/").split("/")
        if len(pieces) != 3 or pieces[:2] != ["v1", "jobs"]:
            self._json(404, {"error": "Route not found."})
            return
        with JOBS_LOCK:
            job = JOBS.get(pieces[2])
            if not job:
                self._json(404, {"error": "Render job not found."})
                return
            job["cancel"].set()
            process = job.get("process")
            if process and process.poll() is None:
                process.terminate()
            if job["status"] in ("queued", "running"):
                job["status"] = "cancelled"
                job["message"] = "Cancellation requested."
        self._json(200, {"id": pieces[2], "status": "cancelled"})


def main() -> None:
    parser = argparse.ArgumentParser(description="GridSplit Studio local FFmpeg renderer")
    parser.add_argument("--host", default="127.0.0.1", choices=["127.0.0.1"], help="Renderer binds to loopback only.")
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--allow-origin", action="append", default=[], help="Exact browser origin allowed to access this local renderer.")
    args = parser.parse_args()
    if not (1024 <= args.port <= 65535):
        parser.error("Port must be between 1024 and 65535.")
    if not args.allow_origin:
        parser.error("Add the exact GridSplit browser origin with --allow-origin.")
    global ALLOWED_ORIGINS
    ALLOWED_ORIGINS = set(args.allow_origin)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.daemon_threads = True
    print("GridSplit local renderer listening on http://127.0.0.1:" + str(args.port), flush=True)
    print("Allowed browser origins: " + ", ".join(sorted(ALLOWED_ORIGINS)), flush=True)
    print("FFmpeg: " + str(shutil.which("ffmpeg")) + " | ffprobe: " + str(shutil.which("ffprobe")), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Stopping GridSplit local renderer.", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
