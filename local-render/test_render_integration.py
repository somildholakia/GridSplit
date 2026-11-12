import hashlib
import json
import math
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
import wave
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import server


def png_pixel(red: int, green: int, blue: int) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    header = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    image = b"\x00" + bytes((red, green, blue))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(image)) + chunk(b"IEND", b"")


def png_rgba_pixel(red: int, green: int, blue: int, alpha: int) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    header = struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0)
    image = b"\x00" + bytes((red, green, blue, alpha))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(image)) + chunk(b"IEND", b"")


def wav_tone(path: Path, seconds: float = 2.0, rate: int = 48000) -> None:
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(rate)
        for index in range(int(seconds * rate)):
            sample = int(4500 * math.sin(2 * math.pi * 440 * index / rate))
            output.writeframesraw(struct.pack("<h", sample))


class MotionLayerExpressionTests(unittest.TestCase):
    def test_keyframe_expression_holds_first_and_last_values_outside_key_range(self):
        expression = server.keyframe_expression([
            {"time": 0.2, "scale": 1.1},
            {"time": 0.6, "scale": 1.3},
            {"time": 0.8, "scale": 1.4},
        ], "scale", 101, 10.0)
        self.assertIn(r"lte(on\\,20.000000)\\,1.100000", expression)
        self.assertIn(r"lte(on\\,80.000000)", expression)
        self.assertIn("1.400000", expression)

    def test_all_particle_presets_produce_rgba_overlay_expressions(self):
        for preset in ("embers", "snow", "rain", "confetti", "magic"):
            with self.subTest(preset=preset):
                result = server.particle_overlay_expressions(preset, 50, 320, 320, 3.0, 24)
                self.assertIsNotNone(result)
                self.assertGreater(result[0], 0)
                self.assertGreater(result[1], 0)
                self.assertIn("min(235", result[5])
        self.assertIsNone(server.particle_overlay_expressions("none", 50, 320, 320, 3.0, 24))
        self.assertIsNone(server.particle_overlay_expressions("embers", 0, 320, 320, 3.0, 24))


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg/ffprobe are not installed in this test environment")
class LocalRenderSmokeTests(unittest.TestCase):
    def test_local_render_produces_probeable_h264_aac_mp4_with_transition_and_mix(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            media = root / "media"
            image_dir = media / "images"
            audio_dir = media / "mix-audio"
            image_dir.mkdir(parents=True)
            audio_dir.mkdir(parents=True)
            first = image_dir / "image-1.png"
            second = image_dir / "image-2.png"
            foreground = image_dir / "foreground.png"
            tone = audio_dir / "tone.wav"
            first.write_bytes(png_pixel(180, 30, 60))
            second.write_bytes(png_pixel(30, 120, 180))
            foreground.write_bytes(png_rgba_pixel(255, 255, 255, 0))
            wav_tone(tone)

            image_hash_1 = hashlib.sha256(first.read_bytes()).hexdigest()
            image_hash_2 = hashlib.sha256(second.read_bytes()).hexdigest()
            foreground_hash = hashlib.sha256(foreground.read_bytes()).hexdigest()
            tone_hash = hashlib.sha256(tone.read_bytes()).hexdigest()
            manifest = {
                "files": [
                    {"path": "media/images/image-1.png", "kind": "image", "assetId": "image-1", "sha256": image_hash_1},
                    {"path": "media/images/image-2.png", "kind": "image", "assetId": "image-2", "sha256": image_hash_2},
                    {"path": "media/images/foreground.png", "kind": "image", "assetId": "foreground-1", "sha256": foreground_hash},
                    {"path": "media/mix-audio/tone.wav", "kind": "mix-audio", "assetId": "tone-1", "sha256": tone_hash},
                ]
            }
            project = {
                "imageAssets": [{"id": "image-1"}, {"id": "image-2"}, {"id": "foreground-1"}],
                "timelineClips": [
                    {"id": "clip-1", "track": "images", "sceneId": "scene-1", "assetId": "image-1", "startSeconds": 0, "durationSeconds": 1, "order": 0},
                    {"id": "clip-2", "track": "images", "sceneId": "scene-1", "assetId": "image-2", "startSeconds": 1, "durationSeconds": 1, "order": 1},
                ],
                "videoClipEdits": [
                    {
                        "clipId": "clip-2", "effect": "none", "transitionIn": "dissolve", "transitionOut": "cut",
                        "transitionDurationSeconds": 0.2, "zoom": 1.12,
                        "keyframes": [
                            {"time": 0, "scale": 1.0, "panX": 0.35, "panY": 0.5, "rotation": -2},
                            {"time": 0.5, "scale": 1.15, "panX": 0.5, "panY": 0.45, "rotation": 0},
                            {"time": 1, "scale": 1.25, "panX": 0.65, "panY": 0.5, "rotation": 2},
                        ],
                        "particlePreset": "embers", "particleIntensity": 35,
                        "parallaxAssetId": "foreground-1", "parallaxAmount": 55,
                    }
                ],
                "audioMixTracks": [
                    {"id": "sfx-track", "kind": "sfx", "volume": 0.4, "muted": False, "solo": False, "fadeInSeconds": 0.1, "fadeOutSeconds": 0.1}
                ],
                "mixAssets": [
                    {"id": "tone-1", "trackId": "sfx-track", "startSeconds": 0, "durationSeconds": 2}
                ],
                "renderProfile": {"width": 320, "height": 320, "fps": 24, "aspectRatio": "1:1", "quality": "compact"},
            }
            command, duration, profile = server.render_command(project, manifest, root)
            result = subprocess.run(command, capture_output=True, text=True, timeout=180)
            self.assertEqual(result.returncode, 0, msg=(result.stderr or result.stdout)[-4000:])
            output = root / "output.mp4"
            self.assertTrue(output.is_file())
            probe = subprocess.run(
                [profile["ffprobe"], "-v", "error", "-show_entries",
                 "format=duration,format_name:stream=codec_type,codec_name,width,height,r_frame_rate",
                 "-of", "json", str(output)],
                capture_output=True, text=True, timeout=60, check=True,
            )
            report = json.loads(probe.stdout)
            video = next(item for item in report["streams"] if item["codec_type"] == "video")
            audio = next(item for item in report["streams"] if item["codec_type"] == "audio")
            self.assertEqual(video["codec_name"], "h264")
            self.assertEqual(audio["codec_name"], "aac")
            self.assertEqual((video["width"], video["height"]), (320, 320))
            self.assertIn("mp4", report["format"]["format_name"])
            self.assertAlmostEqual(float(report["format"]["duration"]), duration, delta=0.25)


if __name__ == "__main__":
    unittest.main()
