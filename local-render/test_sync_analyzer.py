import tempfile
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from sync_analyzer import extract_images, make_text_windows, natural_key, transcribe_audio


class SyncAnalyzerTests(unittest.TestCase):
    def test_natural_sort_places_two_before_ten(self):
        values = ["frame-10.png", "frame-2.png", "frame-1.png"]
        self.assertEqual(sorted(values, key=natural_key), ["frame-1.png", "frame-2.png", "frame-10.png"])

    def test_extract_images_skips_non_images_and_sorts_naturally(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive_path = root / "frames.zip"
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr("frames/frame-10.png", b"image10")
                archive.writestr("frames/frame-2.png", b"image2")
                archive.writestr("frames/readme.txt", "not an image")
            images = extract_images(archive_path, root / "extracted")
            self.assertEqual([item.name for item in images], ["frame-2.png", "frame-10.png"])
            self.assertTrue(all(item.is_file() for item in images))

    def test_extract_images_rejects_path_traversal(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive_path = root / "unsafe.zip"
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr("../outside.png", b"unsafe")
            with self.assertRaisesRegex(ValueError, "Unsafe path"):
                extract_images(archive_path, root / "extracted")

    def test_text_windows_keep_transcript_in_chronological_slices(self):
        segments = [
            {"start": 0.5, "end": 2.0, "text": "Mars is a cold desert."},
            {"start": 7.0, "end": 8.0, "text": "The atmosphere is thin."},
        ]
        windows = make_text_windows(segments, duration=12.0, count=2)
        self.assertEqual(len(windows), 2)
        self.assertIn("Mars", windows[0]["text"])
        self.assertIn("atmosphere", windows[1]["text"])
        self.assertAlmostEqual(windows[0]["startSeconds"], 0.0)
        self.assertAlmostEqual(windows[-1]["endSeconds"], 12.0)

    def test_transcribe_fails_fast_with_actionable_pyav_19_message(self):
        with patch.dict("sys.modules", {"av": SimpleNamespace(__version__="19.0.0")}):
            with self.assertRaisesRegex(RuntimeError, "av==18.1.0"):
                transcribe_audio(Path("unused.wav"))


if __name__ == "__main__":
    unittest.main()
