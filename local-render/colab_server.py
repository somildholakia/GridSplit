#!/usr/bin/env python3
"""Direct chunked FFmpeg render gateway for a temporary Colab Quick Tunnel.

The renderer remains bound to loopback inside Colab. The temporary Quick Tunnel
provides direct browser access from the GridSplit origins listed below.
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import math
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

import server as renderer

MAX_ARCHIVE = renderer.MAX_ARCHIVE
MAX_CHUNK = 3 * 1024 * 1024
MAX_UPLOADS = 2
UPLOADS: dict[str, dict] = {}
UPLOADS_LOCK = threading.RLock()
UPLOAD_TTL_SECONDS = 30 * 60
ALLOWED_ORIGINS = {
    "https://gridsplit-studio.vercel.app",
    "https://gridsplit-kappa.vercel.app",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
}


def prune_uploads(now: float | None = None) -> None:
    """Remove abandoned chunk uploads, including when a notebook is left idle."""
    current = time.time() if now is None else now
    expired: list[Path] = []
    with UPLOADS_LOCK:
        for upload_id, upload in list(UPLOADS.items()):
            updated = float(upload.get("updatedAt", upload.get("createdAt", current)))
            if current - updated > UPLOAD_TTL_SECONDS:
                UPLOADS.pop(upload_id, None)
                expired.append(upload["directory"])
    for directory in expired:
        shutil.rmtree(directory, ignore_errors=True)


def upload_cleanup_loop() -> None:
    while True:
        prune_uploads()
        time.sleep(300)


def add_cors_headers(handler: BaseHTTPRequestHandler) -> None:
    origin = handler.headers.get("Origin")
    if origin in ALLOWED_ORIGINS:
        handler.send_header("Access-Control-Allow-Origin", origin)
        handler.send_header("Vary", "Origin")
        handler.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        handler.send_header("Access-Control-Allow-Headers", "Content-Type, Range")
        handler.send_header("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length")


def json_response(handler: BaseHTTPRequestHandler, status: int, value: dict) -> None:
    body = json.dumps(value).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(body)))
    add_cors_headers(handler)
    handler.end_headers()
    handler.wfile.write(body)


def make_job(archive: Path, project_id: str | None) -> dict:
    directory = Path(tempfile.mkdtemp(prefix="gridsplit-render-"))
    try:
        manifest, project = renderer.extract_verified_archive(archive, directory / "project")
        if project_id and project_id != manifest.get("projectId"):
            raise ValueError("Project ID does not match the uploaded archive.")
        with renderer.JOBS_LOCK:
            active = sum(item.get("status") in ("queued", "running") for item in renderer.JOBS.values())
            if active >= renderer.MAX_ACTIVE_JOBS:
                raise RuntimeError("The Colab renderer is already running two jobs.")
            job_id = uuid.uuid4().hex
            job = {
                "id": job_id, "status": "queued", "progress": 0,
                "message": "Project archive verified. Waiting for the GPU renderer.",
                "error": None, "output": None,
                "directory": str(directory / "project"), "manifest": manifest,
                "project": project, "cancel": threading.Event(), "process": None,
                "createdAt": time.time(),
            }
            renderer.JOBS[job_id] = job
        threading.Thread(target=renderer.execute_job, args=(job_id,), daemon=True).start()
        return {key: job.get(key) for key in ("id", "status", "progress", "message")}
    except Exception:
        shutil.rmtree(directory, ignore_errors=True)
        raise


def drive_source_path(folder_value: str, filename_value: str) -> tuple[Path, Path]:
    drive_root = Path("/content/drive").resolve()
    folder = Path(folder_value).expanduser().resolve()
    if folder == drive_root or drive_root not in folder.parents or not folder.is_dir():
        raise ValueError("Choose a mounted Google Drive folder under /content/drive.")
    relative = renderer.safe_path(filename_value)
    source = folder.joinpath(*relative.parts).resolve()
    if folder not in source.parents or not source.is_file():
        raise FileNotFoundError("Could not find " + filename_value + " in the selected Drive folder.")
    return folder, source


def prepare_drive_job(job_id: str, payload: dict) -> None:
    """Build a normal GridSplit render project from media that stays in mounted Drive."""
    with renderer.JOBS_LOCK:
        job = renderer.JOBS.get(job_id)
        if not job or job["cancel"].is_set():
            return
        root = Path(job["directory"])
        job["message"] = "Checking Google Drive source files and synchronization manifest."
        job["progress"] = 1

    try:
        folder_value = payload.get("folderPath")
        archive_name = payload.get("archiveName")
        audio_name = payload.get("audioName")
        sync = payload.get("syncManifest")
        settings = payload.get("settings") if isinstance(payload.get("settings"), dict) else {}
        if not all(isinstance(value, str) and value.strip() for value in (folder_value, archive_name, audio_name)):
            raise ValueError("Drive folder path, image ZIP filename, and audio filename are required.")
        if not isinstance(sync, dict) or sync.get("format") != "gridsplit-motion-sync" or sync.get("version") != 1:
            raise ValueError("Import a valid GridSplit Smart Sync JSON manifest first.")

        folder, archive_path = drive_source_path(folder_value, archive_name)
        _, audio_path = drive_source_path(folder_value, audio_name)
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(audio_path)],
            capture_output=True, text=True, check=True, timeout=60,
        )
        audio_duration = float(probe.stdout.strip())
        if not (0 < audio_duration <= 24 * 60 * 60):
            raise ValueError("The selected audio has an invalid duration.")
        audio_meta = sync.get("audio")
        if not isinstance(audio_meta, dict) or audio_meta.get("fileName") != audio_path.name:
            raise ValueError("The synchronization JSON was generated for a different audio filename.")
        try:
            declared_duration = float(audio_meta.get("durationSeconds", 0))
        except (TypeError, ValueError):
            raise ValueError("The synchronization JSON has invalid audio duration metadata.")
        if abs(declared_duration - audio_duration) > max(0.5, audio_duration * 0.0005):
            raise ValueError("The Drive audio duration does not match the synchronization JSON. Re-run Smart Sync.")

        sync_images = sync.get("images")
        if not isinstance(sync_images, list) or not sync_images or len(sync_images) > renderer.MAX_ENTRIES:
            raise ValueError("The synchronization JSON contains an invalid image list.")

        root.mkdir(parents=True, exist_ok=True)
        image_dir = root / "media" / "images"
        audio_dir = root / "media" / "mix-audio"
        image_dir.mkdir(parents=True, exist_ok=True)
        audio_dir.mkdir(parents=True, exist_ok=True)

        project_id = "drive-" + uuid.uuid4().hex
        scene_id = uuid.uuid4().hex
        track_id = uuid.uuid4().hex
        audio_asset_id = uuid.uuid4().hex
        files: list[dict] = []
        image_assets: list[dict] = []
        timeline_clips: list[dict] = []
        video_edits: list[dict] = []
        seen_names: set[str] = set()
        cursor = 0.0
        max_expanded = 0

        if archive_path.stat().st_size > MAX_ARCHIVE:
            raise ValueError("The Drive image ZIP exceeds the 3 GB compressed safety limit.")
        with zipfile.ZipFile(archive_path) as bundle:
            if len(bundle.infolist()) > renderer.MAX_ENTRIES:
                raise ValueError("The Drive image ZIP contains too many entries.")
            image_infos: dict[str, zipfile.ZipInfo] = {}
            for info in bundle.infolist():
                if info.is_dir():
                    continue
                try:
                    relative = renderer.safe_path(info.filename)
                except ValueError:
                    raise ValueError("The image ZIP contains an unsafe path.")
                suffix = relative.suffix.lower()
                if suffix in (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"):
                    unix_mode = (info.external_attr >> 16) & 0o170000
                    if unix_mode == 0o120000:
                        raise ValueError("The Drive image ZIP contains a symbolic link.")
                    if info.file_size > 0 and info.compress_size == 0:
                        raise ValueError("The Drive image ZIP contains an invalid compressed image.")
                    if info.compress_size and info.file_size / info.compress_size > 1000:
                        raise ValueError("The Drive image ZIP contains an excessive compression ratio.")
                    image_infos[relative.as_posix()] = info
            if len(image_infos) != len(sync_images):
                raise ValueError("Image count mismatch: ZIP contains " + str(len(image_infos))
                                 + " images, while the sync JSON contains " + str(len(sync_images)) + ".")
            if len(image_infos) > 10000:
                raise ValueError("The source ZIP contains more than 10,000 images.")

            for index, item in enumerate(sync_images):
                with renderer.JOBS_LOCK:
                    current = renderer.JOBS.get(job_id)
                    if not current or current["cancel"].is_set():
                        raise RuntimeError("Drive render was cancelled while preparing source files.")
                    current["progress"] = min(12, 1 + int(11 * index / max(1, len(sync_images))))
                    current["message"] = "Reading Drive image " + str(index + 1) + " of " + str(len(sync_images)) + "."

                if not isinstance(item, dict) or not isinstance(item.get("fileName"), str):
                    raise ValueError("A synchronization image record is invalid.")
                file_name = renderer.safe_path(item["fileName"]).as_posix()
                if file_name in seen_names or file_name not in image_infos:
                    raise ValueError("Missing or duplicate image in the ZIP: " + file_name)
                seen_names.add(file_name)
                info = image_infos[file_name]
                max_expanded += info.file_size
                if max_expanded > 8 * 1024 * 1024 * 1024:
                    raise ValueError("Extracted image media exceeds the 8 GB safety limit.")
                try:
                    start = float(item["startSeconds"])
                    end = float(item["endSeconds"])
                except (KeyError, TypeError, ValueError):
                    raise ValueError("Invalid timing for image " + file_name)
                if not (math.isfinite(start) and math.isfinite(end)) or abs(start - cursor) > 0.08 or end <= start or end - start < 0.2:
                    raise ValueError("The sync timeline contains a gap, overlap, or invalid hold near " + file_name)
                if end > audio_duration + 0.5:
                    raise ValueError("Image timing extends beyond the audio duration.")
                cursor = end

                asset_id = uuid.uuid4().hex
                suffix = Path(file_name).suffix.lower()
                target_name = asset_id + suffix
                relative_target = "media/images/" + target_name
                target = root / relative_target
                digest = __import__("hashlib").sha256()
                with bundle.open(info) as source, target.open("wb") as output:
                    for chunk in iter(lambda: source.read(1024 * 1024), b""):
                        output.write(chunk)
                        digest.update(chunk)

                mime_type = mimetypes.guess_type(file_name)[0] or "image/jpeg"
                width, height = 1, 1
                try:
                    from PIL import Image
                    with Image.open(target) as image_file:
                        width, height = image_file.size
                except Exception:
                    pass

                image_assets.append({
                    "id": asset_id, "name": Path(file_name).name,
                    "relativePath": "motion-studio/" + file_name,
                    "mimeType": mime_type, "bytes": info.file_size,
                    "sequenceNumber": index + 1, "order": index,
                    "width": width, "height": height, "fingerprint": digest.hexdigest(),
                })
                files.append({
                    "path": relative_target, "sizeBytes": info.file_size,
                    "sha256": digest.hexdigest(), "assetId": asset_id, "kind": "image",
                })
                clip_id = uuid.uuid4().hex
                timeline_clips.append({
                    "id": clip_id, "track": "images", "sceneId": scene_id,
                    "assetId": asset_id, "startSeconds": start,
                    "durationSeconds": end - start, "order": index,
                })
                transition = settings.get("transition", "dissolve")
                if transition not in ("cut", "dissolve", "fade", "wipe-left", "wipe-right"):
                    transition = "dissolve"
                effect = settings.get("effect", "ken-burns")
                if effect not in ("ken-burns", "zoom-in", "zoom-out", "pan-left", "pan-right", "none"):
                    effect = "ken-burns"
                video_edits.append({
                    "clipId": clip_id, "effect": effect,
                    "transitionIn": "cut" if index == 0 else transition,
                    "transitionOut": transition,
                    "transitionDurationSeconds": 0 if transition == "cut" else min(5.0, max(0.05, float(settings.get("transitionDurationSeconds", 0.6)))),
                    "zoom": min(1.5, max(1.0, float(settings.get("zoom", 1.16)))),
                })

        if seen_names != set(image_infos):
            raise ValueError("The sync JSON does not reference every image in the ZIP.")
        if not math.isfinite(cursor) or abs(cursor - audio_duration) > max(0.5, audio_duration * 0.0005):
            raise ValueError("The synchronization timeline does not cover the complete audio. Re-run Smart Sync.")

        audio_size = audio_path.stat().st_size
        if audio_size <= 0 or audio_size > 3 * 1024 * 1024 * 1024:
            raise ValueError("The soundtrack must be smaller than 3 GB.")
        audio_target_name = audio_asset_id + audio_path.suffix.lower()
        audio_relative = "media/mix-audio/" + audio_target_name
        audio_target = root / audio_relative
        shutil.copyfile(audio_path, audio_target)
        audio_sha = renderer.sha256_file(audio_target)
        audio_mime = mimetypes.guess_type(audio_path.name)[0] or "audio/wav"
        files.append({
            "path": audio_relative, "sizeBytes": audio_size,
            "sha256": audio_sha, "assetId": audio_asset_id, "kind": "mix-audio",
        })

        try:
            width = int(settings.get("width", 1920))
            height = int(settings.get("height", 1080))
            fps = float(settings.get("fps", 30))
        except (TypeError, ValueError):
            raise ValueError("Invalid render dimensions or frame rate.")
        ratio = str(settings.get("aspectRatio", "16:9"))
        if not (320 <= width <= 3840 and 320 <= height <= 3840 and width % 2 == 0 and height % 2 == 0):
            raise ValueError("Output dimensions must be even and between 320 and 3840 pixels.")
        if fps not in (23.976, 24, 25, 29.97, 30, 50, 59.94, 60):
            raise ValueError("Unsupported frame rate.")
        if ratio not in ("16:9", "9:16", "1:1"):
            raise ValueError("Unsupported output aspect ratio.")

        project = {
            "id": project_id,
            "name": "GridSplit Drive Smart Sync",
            "source": "",
            "scenes": [{
                "id": scene_id, "title": "Drive Smart Sync", "chapter": "Motion Studio",
                "blocks": [], "sourceText": "",
            }],
            "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "imageAssets": image_assets,
            "imageMappings": [{"sceneId": scene_id, "imageIds": [item["id"] for item in image_assets]}],
            "timelineClips": timeline_clips,
            "audioMixTracks": [{
                "id": track_id, "kind": "music", "name": "Drive soundtrack",
                "volume": 1, "muted": False, "solo": False,
                "fadeInSeconds": 0.5, "fadeOutSeconds": 1.5,
            }],
            "mixAssets": [{
                "id": audio_asset_id, "name": audio_path.name, "mimeType": audio_mime,
                "bytes": audio_size, "kind": "music", "trackId": track_id,
                "startSeconds": 0, "durationSeconds": audio_duration, "order": 0,
            }],
            "videoClipEdits": video_edits,
            "renderProfile": {
                "width": width, "height": height, "fps": fps,
                "aspectRatio": ratio, "quality": "balanced", "encoder": "nvidia",
            },
        }
        manifest = {
            "format": "gridsplit-studio-project", "version": 1,
            "projectId": project_id, "files": files,
        }

        with renderer.JOBS_LOCK:
            current = renderer.JOBS.get(job_id)
            if not current or current["cancel"].is_set():
                raise RuntimeError("Drive render was cancelled before FFmpeg started.")
            current["project"] = project
            current["manifest"] = manifest
            current["progress"] = 14
            current["message"] = "Drive media is prepared. Starting the T4 FFmpeg renderer."
        threading.Thread(target=renderer.execute_job, args=(job_id,), daemon=True).start()
    except Exception as error:
        with renderer.JOBS_LOCK:
            current = renderer.JOBS.get(job_id)
            if current:
                current["status"] = "cancelled" if current["cancel"].is_set() else "failed"
                current["error"] = str(error)
                current["message"] = str(error)
                current["finishedAt"] = time.time()
        shutil.rmtree(root.parent, ignore_errors=True)


def create_drive_job(payload: dict) -> dict:
    if not Path("/content/drive").is_dir():
        raise RuntimeError("Google Drive is not mounted in this Colab runtime. Run the Smart Sync + Live Renderer notebook first.")
    with renderer.JOBS_LOCK:
        renderer.prune_finished_jobs()
        active = sum(item.get("status") in ("queued", "running") for item in renderer.JOBS.values())
        if active >= renderer.MAX_ACTIVE_JOBS:
            raise RuntimeError("The Colab renderer is already running two jobs.")
        job_id = uuid.uuid4().hex
        parent = Path(tempfile.mkdtemp(prefix="gridsplit-render-drive-"))
        project_root = parent / "project"
        project_root.mkdir(parents=True)
        job = {
            "id": job_id, "status": "queued", "progress": 0,
            "message": "Queued. Colab will read source media directly from Drive.",
            "error": None, "output": None,
            "directory": str(project_root), "manifest": {}, "project": {},
            "cancel": threading.Event(), "process": None, "createdAt": time.time(),
        }
        renderer.JOBS[job_id] = job
    threading.Thread(target=prepare_drive_job, args=(job_id, payload), daemon=True).start()
    return {key: job.get(key) for key in ("id", "status", "progress", "message")}


class Handler(BaseHTTPRequestHandler):
    server_version = "GridSplitColabRenderer/1.0"

    def log_message(self, fmt: str, *args) -> None:
        # Never log request headers or query strings.
        message = fmt % args
        if "?" in message:
            message = message.split("?", 1)[0]
        print("[GridSplit Colab] " + message, flush=True)

    def guard(self) -> bool:
        origin = self.headers.get("Origin")
        if origin and origin not in ALLOWED_ORIGINS:
            json_response(self, 403, {"error": "This browser origin is not allowed to access the GridSplit Colab renderer."})
            return False
        if urlsplit(self.path).query:
            json_response(self, 400, {"error": "Query strings are not accepted by the Colab renderer."})
            return False
        prune_uploads()
        renderer.prune_finished_jobs()
        return True

    def do_OPTIONS(self) -> None:
        origin = self.headers.get("Origin")
        if origin not in ALLOWED_ORIGINS:
            json_response(self, 403, {"error": "This browser origin is not allowed."})
            return
        self.send_response(204)
        add_cors_headers(self)
        self.end_headers()

    def read_json(self, limit: int = 64 * 1024) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > limit:
            raise ValueError("Invalid JSON request size.")
        value = json.loads(self.rfile.read(length))
        if not isinstance(value, dict):
            raise ValueError("Expected a JSON object.")
        return value

    def do_GET(self) -> None:
        if not self.guard():
            return
        renderer.prune_finished_jobs()
        parts = urlsplit(self.path).path.strip("/").split("/")
        if parts == ["v1", "health"]:
            gpu = False
            gpu_name = None
            try:
                probe = subprocess.run(["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
                                       capture_output=True, text=True, timeout=5, check=True)
                gpu_name = probe.stdout.strip().splitlines()[0] if probe.stdout.strip() else None
                gpu = bool(gpu_name)
            except (OSError, subprocess.SubprocessError, IndexError):
                pass
            json_response(self, 200, {
                "ready": bool(shutil.which("ffmpeg") and shutil.which("ffprobe")),
                "ffmpeg": shutil.which("ffmpeg"), "ffprobe": shutil.which("ffprobe"),
                "gpuAvailable": gpu, "gpuName": gpu_name,
                "message": "Authenticated Colab FFmpeg renderer is ready.",
            })
            return
        if len(parts) == 3 and parts[:2] == ["v1", "jobs"]:
            self.send_job(parts[2])
            return
        if len(parts) == 4 and parts[:2] == ["v1", "jobs"] and parts[3] == "output":
            self.send_output(parts[2])
            return
        json_response(self, 404, {"error": "Route not found."})

    def send_job(self, job_id: str) -> None:
        with renderer.JOBS_LOCK:
            job = renderer.JOBS.get(job_id)
            if not job:
                json_response(self, 404, {"error": "Render job not found."})
                return
            snapshot = {key: job.get(key) for key in ("id", "status", "progress", "message", "error", "output")}
        json_response(self, 200, snapshot)

    def send_output(self, job_id: str) -> None:
        with renderer.JOBS_LOCK:
            job = renderer.JOBS.get(job_id)
            if not job or job.get("status") != "completed":
                json_response(self, 409, {"error": "Render output is not ready."})
                return
            output = Path(job["directory"]) / "output.mp4"
        if not output.is_file():
            json_response(self, 404, {"error": "Rendered MP4 is missing."})
            return
        total = output.stat().st_size
        header = self.headers.get("Range", "")
        start, end, status = 0, total - 1, 200
        if header:
            try:
                unit, value = header.split("=", 1)
                first, last = value.split("-", 1)
                if unit != "bytes" or not first:
                    raise ValueError
                start = int(first)
                end = min(total - 1, int(last)) if last else total - 1
                if start < 0 or start >= total or end < start:
                    raise ValueError
                status = 206
            except ValueError:
                json_response(self, 416, {"error": "Invalid byte range."})
                return
        length = end - start + 1
        self.send_response(status)
        self.send_header("Content-Type", "video/mp4")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        if status == 206:
            self.send_header("Content-Range", "bytes " + str(start) + "-" + str(end) + "/" + str(total))
        self.send_header("Cache-Control", "no-store")
        add_cors_headers(self)
        self.end_headers()
        with output.open("rb") as handle:
            handle.seek(start)
            shutil.copyfileobj(_LimitedReader(handle, length), self.wfile)

    def do_POST(self) -> None:
        if not self.guard():
            return
        parts = urlsplit(self.path).path.strip("/").split("/")
        try:
            if parts == ["v1", "drive", "render"]:
                data = self.read_json(limit=10 * 1024 * 1024)
                result = create_drive_job(data)
                json_response(self, 202, result)
                return
            if parts == ["v1", "uploads"]:
                data = self.read_json()
                size = int(data.get("size", 0))
                chunk_size = int(data.get("chunkSize", MAX_CHUNK))
                count = int(data.get("chunkCount", 0))
                project_id = str(data.get("projectId", ""))
                if size <= 0 or size > MAX_ARCHIVE or chunk_size != MAX_CHUNK:
                    raise ValueError("Archive size or chunk size is invalid (maximum compressed archive is 3 GB).")
                if count != (size + chunk_size - 1) // chunk_size or count > 1024:
                    raise ValueError("Chunk count does not match the archive size.")
                with UPLOADS_LOCK:
                    if len(UPLOADS) >= MAX_UPLOADS:
                        raise RuntimeError("Too many uploads are active. Finish or cancel one first.")
                    upload_id = uuid.uuid4().hex
                    directory = Path(tempfile.mkdtemp(prefix="gridsplit-colab-upload-"))
                    UPLOADS[upload_id] = {
                        "directory": directory, "size": size, "chunkSize": chunk_size,
                        "chunkCount": count, "projectId": project_id, "received": set(),
                        "createdAt": time.time(), "updatedAt": time.time(),
                    }
                json_response(self, 201, {"uploadId": upload_id, "chunkSize": chunk_size, "chunkCount": count})
                return
            if len(parts) == 4 and parts[:2] == ["v1", "uploads"] and parts[3] == "complete":
                upload_id = parts[2]
                with UPLOADS_LOCK:
                    upload = UPLOADS.get(upload_id)
                    if not upload:
                        json_response(self, 404, {"error": "Upload session not found."})
                        return
                    if len(upload["received"]) != upload["chunkCount"]:
                        json_response(self, 409, {"error": "Some archive chunks are still missing."})
                        return
                    directory = upload["directory"]
                    archive = directory / "project.zip"
                    with archive.open("wb") as target:
                        for index in range(upload["chunkCount"]):
                            with (directory / (str(index) + ".part")).open("rb") as part:
                                shutil.copyfileobj(part, target)
                    if archive.stat().st_size != upload["size"]:
                        raise ValueError("Assembled archive size does not match the upload declaration.")
                    try:
                        result = make_job(archive, upload["projectId"])
                    except Exception:
                        UPLOADS.pop(upload_id, None)
                        shutil.rmtree(directory, ignore_errors=True)
                        raise
                    UPLOADS.pop(upload_id, None)
                shutil.rmtree(directory, ignore_errors=True)
                json_response(self, 202, result)
                return
        except Exception as error:
            json_response(self, 400, {"error": str(error)})
            return
        json_response(self, 404, {"error": "Route not found."})

    def do_PUT(self) -> None:
        if not self.guard():
            return
        parts = urlsplit(self.path).path.strip("/").split("/")
        if len(parts) != 4 or parts[:2] != ["v1", "uploads"]:
            json_response(self, 404, {"error": "Route not found."})
            return
        upload_id = parts[2]
        try:
            index = int(parts[3])
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_CHUNK:
                raise ValueError("Each chunk must be between 1 byte and 3 MB.")
            with UPLOADS_LOCK:
                upload = UPLOADS.get(upload_id)
                if not upload:
                    json_response(self, 404, {"error": "Upload session not found."})
                    return
                if index < 0 or index >= upload["chunkCount"]:
                    raise ValueError("Chunk index is outside the upload session.")
                expected = min(upload["chunkSize"], upload["size"] - index * upload["chunkSize"])
                if length != expected:
                    raise ValueError("Chunk byte length does not match its position.")
                payload = self.rfile.read(length)
                if len(payload) != length:
                    raise ValueError("Chunk upload ended early.")
                target = upload["directory"] / (str(index) + ".part")
                with target.open("wb") as handle:
                    handle.write(payload)
                upload["received"].add(index)
                upload["updatedAt"] = time.time()
                received = len(upload["received"])
            json_response(self, 200, {"received": received, "total": upload["chunkCount"]})
        except Exception as error:
            json_response(self, 400, {"error": str(error)})

    def do_DELETE(self) -> None:
        if not self.guard():
            return
        parts = urlsplit(self.path).path.strip("/").split("/")
        if len(parts) == 3 and parts[:2] == ["v1", "jobs"]:
            with renderer.JOBS_LOCK:
                job = renderer.JOBS.get(parts[2])
                if not job:
                    json_response(self, 404, {"error": "Render job not found."})
                    return
                job["cancel"].set()
                process = job.get("process")
                if process and process.poll() is None:
                    process.terminate()
                if job["status"] in ("queued", "running"):
                    job["status"] = "cancelled"
                    job["message"] = "Cancellation requested."
            json_response(self, 200, {"id": parts[2], "status": "cancelled"})
            return
        if len(parts) == 3 and parts[:2] == ["v1", "uploads"]:
            with UPLOADS_LOCK:
                upload = UPLOADS.pop(parts[2], None)
            if upload:
                shutil.rmtree(upload["directory"], ignore_errors=True)
            json_response(self, 200, {"id": parts[2], "status": "cancelled"})
            return
        json_response(self, 404, {"error": "Route not found."})


class _LimitedReader:
    def __init__(self, handle, remaining: int):
        self.handle = handle
        self.remaining = remaining

    def read(self, size: int = -1) -> bytes:
        if self.remaining <= 0:
            return b""
        chunk = self.handle.read(min(self.remaining, 1024 * 1024 if size < 0 else size))
        self.remaining -= len(chunk)
        return chunk


def main() -> None:
    parser = argparse.ArgumentParser(description="GridSplit direct Colab FFmpeg renderer")
    parser.add_argument("--host", default="127.0.0.1", choices=["127.0.0.1"],
                        help="Bind to loopback and expose through the temporary Colab Quick Tunnel.")
    parser.add_argument("--port", type=int, default=8766)
    args = parser.parse_args()
    if not (1024 <= args.port <= 65535):
        parser.error("Port must be between 1024 and 65535.")
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    httpd.daemon_threads = True
    print("GridSplit Colab renderer listening on 127.0.0.1:" + str(args.port), flush=True)
    print("Direct Colab API ready. Keep this runtime and its Quick Tunnel active.", flush=True)
    threading.Thread(target=upload_cleanup_loop, daemon=True).start()
    try:
        httpd.serve_forever()
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
