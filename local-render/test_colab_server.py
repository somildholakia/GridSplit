import tempfile
import unittest
from pathlib import Path

import colab_server


class FakeHeaders(dict):
    def get(self, key, default=""):
        return super().get(key, default)


class ColabGatewaySecurityTests(unittest.TestCase):
    def setUp(self):
        self.original_token = colab_server.AUTH_TOKEN
        self.original_uploads = dict(colab_server.UPLOADS)
        colab_server.UPLOADS.clear()
        colab_server.AUTH_TOKEN = "test-secret-token-" + ("x" * 40)

    def tearDown(self):
        colab_server.AUTH_TOKEN = self.original_token
        for upload in colab_server.UPLOADS.values():
            import shutil
            shutil.rmtree(upload["directory"], ignore_errors=True)
        colab_server.UPLOADS.clear()
        colab_server.UPLOADS.update(self.original_uploads)

    def test_token_is_required_and_compared_from_header(self):
        handler = type("HandlerStub", (), {"headers": FakeHeaders({
            "X-GridSplit-Token": colab_server.AUTH_TOKEN,
        })})()
        self.assertTrue(colab_server.Handler.authorized(handler))
        handler.headers["X-GridSplit-Token"] = "wrong-token"
        self.assertFalse(colab_server.Handler.authorized(handler))
        handler.headers.clear()
        self.assertFalse(colab_server.Handler.authorized(handler))

    def test_expired_upload_is_pruned_and_directory_removed(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / "abandoned"
            directory.mkdir()
            (directory / "0.part").write_bytes(b"partial")
            now = 2_000_000_000.0
            colab_server.UPLOADS["expired"] = {
                "directory": directory,
                "createdAt": now - colab_server.UPLOAD_TTL_SECONDS - 10,
                "updatedAt": now - colab_server.UPLOAD_TTL_SECONDS - 10,
                "received": set(),
            }
            colab_server.prune_uploads(now)
            self.assertNotIn("expired", colab_server.UPLOADS)
            self.assertFalse(directory.exists())

    def test_recent_upload_is_preserved(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / "active"
            directory.mkdir()
            now = 2_000_000_000.0
            colab_server.UPLOADS["active"] = {
                "directory": directory,
                "createdAt": now - 10,
                "updatedAt": now - 10,
                "received": set(),
            }
            colab_server.prune_uploads(now)
            self.assertIn("active", colab_server.UPLOADS)
            self.assertTrue(directory.exists())


if __name__ == "__main__":
    unittest.main()
