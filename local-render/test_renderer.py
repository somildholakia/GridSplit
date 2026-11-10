import hashlib
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import server


class SafePathTests(unittest.TestCase):
    def test_accepts_relative_archive_path(self):
        self.assertEqual(str(server.safe_path("media/images/frame-01.png")), "media/images/frame-01.png")

    def test_rejects_traversal_and_absolute_paths(self):
        for value in ("../escape.txt", "/absolute.txt", "media/../../escape", "C:/escape", r"media\images\frame.png"):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    server.safe_path(value)


class ArchiveValidationTests(unittest.TestCase):
    def create_archive(self, root: Path, payload: bytes, digest: str | None = None) -> Path:
        path = root / "project.zip"
        digest = digest or hashlib.sha256(payload).hexdigest()
        manifest = {
            "format": "gridsplit-studio-project",
            "version": 1,
            "projectId": "project-1",
            "files": [{
                "path": "media/images/image-1.png",
                "kind": "image",
                "assetId": "image-1",
                "mimeType": "image/png",
                "sizeBytes": len(payload),
                "sha256": digest,
            }],
        }
        project = {"id": "project-1", "imageAssets": [{"id": "image-1"}]}
        with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
            bundle.writestr("manifest.json", json.dumps(manifest))
            bundle.writestr("project.json", json.dumps(project))
            bundle.writestr("media/images/image-1.png", payload)
        return path

    def test_extracts_and_verifies_media_checksum(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = self.create_archive(root, b"local-image-bytes")
            manifest, project = server.extract_verified_archive(archive, root / "out")
            self.assertEqual(project["id"], "project-1")
            self.assertEqual(manifest["files"][0]["assetId"], "image-1")
            restored = root / "out/media/images/image-1.png"
            self.assertEqual(restored.read_bytes(), b"local-image-bytes")

    def test_rejects_bad_media_checksum(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = self.create_archive(root, b"tampered", "0" * 64)
            with self.assertRaisesRegex(ValueError, "SHA-256"):
                server.extract_verified_archive(archive, root / "out")

    def test_rejects_archive_manifest_path_traversal(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = root / "unsafe.zip"
            manifest = {
                "format": "gridsplit-studio-project", "version": 1, "projectId": "p",
                "files": [{"path": "media/images/../../escape.png", "kind": "image",
                           "assetId": "i", "mimeType": "image/png", "sizeBytes": 1, "sha256": "0" * 64}],
            }
            with zipfile.ZipFile(archive, "w") as bundle:
                bundle.writestr("manifest.json", json.dumps(manifest))
                bundle.writestr("project.json", json.dumps({"id": "p"}))
                bundle.writestr("media/images/../../escape.png", b"x")
            with self.assertRaises(ValueError):
                server.extract_verified_archive(archive, root / "out")


if __name__ == "__main__":
    unittest.main()
