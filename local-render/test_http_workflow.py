"""Exercise ZIP upload, local job API, FFmpeg render and MP4 download."""
from __future__ import annotations

import hashlib
import json
import shutil
import struct
import tempfile
import threading
import time
import urllib.request
import unittest
import zlib
import zipfile
from http.server import ThreadingHTTPServer
from pathlib import Path

import server


def png_pixel(red: int, green: int, blue: int) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    header = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    image = b"\x00" + bytes((red, green, blue))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(image)) + chunk(b"IEND", b"")


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg/ffprobe are required for this HTTP render test")
class LocalRendererHttpWorkflowTests(unittest.TestCase):
    def test_archive_upload_job_poll_and_mp4_download(self):
        image = png_pixel(80, 120, 170)
        depth_map = png_pixel(190, 190, 190)
        image_path = "media/images/image-1.png"
        depth_path = "media/images/depth-map-1.png"
        project = {
            "id": "http-integration-project",
            "name": "HTTP integration fixture",
            "scenes": [{"id": "scene-1", "title": "Scene 1", "chapter": "Chapter 1", "blocks": []}],
            "imageAssets": [{"id": "image-1"}, {"id": "depth-map-1"}],
            "videoClipEdits": [{
                "clipId": "clip-1", "effect": "none", "transitionIn": "cut",
                "transitionOut": "cut", "transitionDurationSeconds": 0, "zoom": 1,
                "depthMapAssetId": "depth-map-1", "depthMotionAmount": 40,
            }],
            "timelineClips": [{
                "id": "clip-1", "track": "images", "sceneId": "scene-1",
                "assetId": "image-1", "startSeconds": 0, "durationSeconds": 1,
                "order": 0,
            }],
            "renderProfile": {"width": 320, "height": 320, "fps": 24, "aspectRatio": "1:1", "quality": "compact"},
        }
        manifest = {
            "format": "gridsplit-studio-project",
            "version": 1,
            "createdAt": "2026-11-10T00:00:00Z",
            "projectId": project["id"],
            "files": [{
                "path": image_path,
                "kind": "image",
                "assetId": "image-1",
                "mimeType": "image/png",
                "sizeBytes": len(image),
                "sha256": hashlib.sha256(image).hexdigest(),
            }, {
                "path": depth_path,
                "kind": "image",
                "assetId": "depth-map-1",
                "mimeType": "image/png",
                "sizeBytes": len(depth_map),
                "sha256": hashlib.sha256(depth_map).hexdigest(),
            }],
        }
        with tempfile.NamedTemporaryFile(suffix=".zip") as archive_file:
            with zipfile.ZipFile(archive_file, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
                bundle.writestr("project.json", json.dumps(project))
                bundle.writestr("manifest.json", json.dumps(manifest))
                bundle.writestr(image_path, image)
                bundle.writestr(depth_path, depth_map)
            archive_file.flush()
            payload = Path(archive_file.name).read_bytes()

        previous_origins = server.ALLOWED_ORIGINS
        server.ALLOWED_ORIGINS = {"http://localhost:5173"}
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        httpd.daemon_threads = True
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        job_id = None
        job_directory = None
        try:
            thread.start()
            endpoint = "http://127.0.0.1:" + str(httpd.server_port)
            request = urllib.request.Request(
                endpoint + "/v1/jobs",
                data=payload,
                headers={
                    "Content-Type": "application/zip",
                    "Origin": "http://localhost:5173",
                    "X-GridSplit-Project": project["id"],
                },
                method="POST",
            )
            with urllib.request.urlopen(request, timeout=15) as response:
                self.assertEqual(response.status, 202)
                job_id = json.loads(response.read())["id"]

            deadline = time.monotonic() + 60
            snapshot = {}
            while time.monotonic() < deadline:
                poll = urllib.request.Request(endpoint + "/v1/jobs/" + job_id, headers={"Origin": "http://localhost:5173"})
                with urllib.request.urlopen(poll, timeout=10) as response:
                    snapshot = json.loads(response.read())
                if snapshot["status"] not in ("queued", "running"):
                    break
                time.sleep(0.15)
            self.assertEqual(snapshot.get("status"), "completed", msg=str(snapshot))
            self.assertEqual(snapshot["output"]["videoCodec"], "h264")
            self.assertEqual(snapshot["output"]["audioCodec"], "aac")

            download = urllib.request.Request(endpoint + "/v1/jobs/" + job_id + "/output", headers={"Origin": "http://localhost:5173"})
            with urllib.request.urlopen(download, timeout=15) as response:
                mp4 = response.read()
                self.assertEqual(response.headers.get("Content-Type"), "video/mp4")
            self.assertGreater(len(mp4), 1024)
            self.assertIn(b"ftyp", mp4[:64])
        finally:
            if job_id:
                with server.JOBS_LOCK:
                    stored = server.JOBS.pop(job_id, None)
                    if stored:
                        job_directory = Path(stored["directory"]).parent
            if job_directory:
                shutil.rmtree(job_directory, ignore_errors=True)
            httpd.shutdown()
            httpd.server_close()
            thread.join(timeout=5)
            server.ALLOWED_ORIGINS = previous_origins


if __name__ == "__main__":
    unittest.main()
