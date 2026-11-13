#!/usr/bin/env python3
"""Authenticated chunked FFmpeg render gateway for a temporary Colab Quick Tunnel.

The local renderer remains loopback-only. This separate gateway is used only in a
Colab runtime and requires a high-entropy bearer token for every API request.
"""
from __future__ import annotations

import argparse
import hmac
import json
import os
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
AUTH_TOKEN = ""


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


def json_response(handler: BaseHTTPRequestHandler, status: int, value: dict) -> None:
    body = json.dumps(value).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(body)))
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


class Handler(BaseHTTPRequestHandler):
    server_version = "GridSplitColabRenderer/1.0"

    def log_message(self, fmt: str, *args) -> None:
        # Never log request headers, query strings, or authentication material.
        message = fmt % args
        if "?" in message:
            message = message.split("?", 1)[0]
        print("[GridSplit Colab] " + message, flush=True)

    def authorized(self) -> bool:
        supplied = self.headers.get("X-GridSplit-Token", "")
        return bool(AUTH_TOKEN) and hmac.compare_digest(supplied, AUTH_TOKEN)

    def guard(self) -> bool:
        if not self.authorized():
            json_response(self, 401, {"error": "Invalid or missing GridSplit Colab connection token."})
            return False
        # The browser sends credentials in a header only; reject query strings
        # so tokens cannot accidentally migrate into URL or access logs.
        if urlsplit(self.path).query:
            json_response(self, 400, {"error": "Query strings are not accepted by the Colab renderer."})
            return False
        prune_uploads()
        renderer.prune_finished_jobs()
        return True

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
        self.end_headers()
        with output.open("rb") as handle:
            handle.seek(start)
            shutil.copyfileobj(_LimitedReader(handle, length), self.wfile)

    def do_POST(self) -> None:
        if not self.guard():
            return
        parts = urlsplit(self.path).path.strip("/").split("/")
        try:
            if parts == ["v1", "uploads"]:
                data = self.read_json()
                size = int(data.get("size", 0))
                chunk_size = int(data.get("chunkSize", MAX_CHUNK))
                count = int(data.get("chunkCount", 0))
                project_id = str(data.get("projectId", ""))
                if size <= 0 or size > MAX_ARCHIVE or chunk_size != MAX_CHUNK:
                    raise ValueError("Archive size or chunk size is invalid (maximum compressed archive is 1 GB).")
                if count != (size + chunk_size - 1) // chunk_size or count > 400:
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
    parser = argparse.ArgumentParser(description="Authenticated GridSplit Colab FFmpeg renderer")
    parser.add_argument("--host", default="127.0.0.1", choices=["127.0.0.1"],
                        help="The authenticated renderer is loopback-only; expose it only through the notebook's Quick Tunnel.")
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--token", default=os.environ.get("GRID_SPLIT_COLAB_TOKEN", ""),
                        help="Optional token override; prefer GRID_SPLIT_COLAB_TOKEN environment variable.")
    args = parser.parse_args()
    if not (1024 <= args.port <= 65535):
        parser.error("Port must be between 1024 and 65535.")
    if len(args.token) < 32:
        parser.error("A high-entropy token of at least 32 characters is required in GRID_SPLIT_COLAB_TOKEN or --token.")
    global AUTH_TOKEN
    AUTH_TOKEN = args.token
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    httpd.daemon_threads = True
    print("GridSplit Colab renderer listening on 127.0.0.1:" + str(args.port), flush=True)
    print("Authenticated API ready. Keep this runtime and its Quick Tunnel active.", flush=True)
    threading.Thread(target=upload_cleanup_loop, daemon=True).start()
    try:
        httpd.serve_forever()
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
