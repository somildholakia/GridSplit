import tempfile
import unittest
from pathlib import Path

import colab_server


class HeaderSink:
    def __init__(self, origin):
        self.headers = {"Origin": origin}
        self.sent = {}
    def send_header(self, key, value): self.sent[key] = value

class ColabGatewayTests(unittest.TestCase):
    def setUp(self):
        self.original_uploads = dict(colab_server.UPLOADS)
        colab_server.UPLOADS.clear()
    def tearDown(self):
        import shutil
        for upload in colab_server.UPLOADS.values(): shutil.rmtree(upload["directory"], ignore_errors=True)
        colab_server.UPLOADS.clear()
        colab_server.UPLOADS.update(self.original_uploads)
    def test_grid_split_origin_receives_direct_cors_headers(self):
        origin = "https://gridsplit-studio.vercel.app"
        sink = HeaderSink(origin)
        colab_server.add_cors_headers(sink)
        self.assertEqual(sink.sent["Access-Control-Allow-Origin"], origin)
        self.assertIn("PUT", sink.sent["Access-Control-Allow-Methods"])
        self.assertIn("Content-Type", sink.sent["Access-Control-Allow-Headers"])
    def test_unlisted_origin_does_not_receive_cors_permission(self):
        sink = HeaderSink("https://untrusted.example")
        colab_server.add_cors_headers(sink)
        self.assertNotIn("Access-Control-Allow-Origin", sink.sent)
    def test_expired_upload_is_pruned_and_directory_removed(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / "abandoned"
            directory.mkdir()
            (directory / "0.part").write_bytes(b"partial")
            now = 2_000_000_000.0
            colab_server.UPLOADS["expired"] = {"directory": directory, "createdAt": now-colab_server.UPLOAD_TTL_SECONDS-10, "updatedAt": now-colab_server.UPLOAD_TTL_SECONDS-10, "received": set()}
            colab_server.prune_uploads(now)
            self.assertNotIn("expired", colab_server.UPLOADS)
            self.assertFalse(directory.exists())
    def test_recent_upload_is_preserved(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / "active"
            directory.mkdir()
            now = 2_000_000_000.0
            colab_server.UPLOADS["active"] = {"directory": directory, "createdAt": now-10, "updatedAt": now-10, "received": set()}
            colab_server.prune_uploads(now)
            self.assertIn("active", colab_server.UPLOADS)
            self.assertTrue(directory.exists())

if __name__ == "__main__": unittest.main()
