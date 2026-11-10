from __future__ import annotations

import hashlib
import io
import json
import unittest
import wave
from unittest.mock import patch
from zipfile import ZipFile

import acceptance_check


def wav_bytes(seconds: float = 0.25, rate: int = 24000) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(rate)
        audio.writeframes(b"\x00\x00" * int(seconds * rate))
    return buffer.getvalue()


class AcceptanceCheckTests(unittest.TestCase):
    def test_inspect_wav_reads_real_sample_metadata(self):
        data = wav_bytes()
        result = acceptance_check.inspect_wav(data)
        self.assertEqual(result["sample_rate"], 24000)
        self.assertEqual(result["sample_count"], 6000)
        self.assertEqual(result["channels"], 1)
        self.assertAlmostEqual(result["duration_seconds"], 0.25)

    def test_inspect_wav_rejects_non_wave_data(self):
        with self.assertRaises((ValueError, wave.Error, EOFError)):
            acceptance_check.inspect_wav(b"not a wav file")

    def test_smoke_archive_contains_hash_verified_image_and_generated_audio(self):
        audio = wav_bytes()
        info = acceptance_check.inspect_wav(audio)
        archive, project_id = acceptance_check.build_smoke_archive(audio, info)
        with ZipFile(io.BytesIO(archive)) as bundle:
            manifest = json.loads(bundle.read("manifest.json"))
            project = json.loads(bundle.read("project.json"))
            self.assertEqual(project["id"], project_id)
            self.assertEqual(manifest["projectId"], project_id)
            self.assertEqual(len(manifest["files"]), 2)
            for record in manifest["files"]:
                payload = bundle.read(record["path"])
                self.assertEqual(record["sizeBytes"], len(payload))
                self.assertEqual(record["sha256"], hashlib.sha256(payload).hexdigest())
            self.assertEqual(project["audioSegments"][0]["sampleCount"], info["sample_count"])
            self.assertEqual(project["timelineClips"][0]["track"], "images")
            self.assertEqual(project["timelineClips"][1]["track"], "audio")

    def test_preflight_requires_exact_origin_and_private_network_header(self):
        class Headers(dict):
            pass

        with patch.object(
            acceptance_check,
            "http_request",
            return_value=(204, Headers({
                "Access-Control-Allow-Origin": "https://gridsplit-kappa.vercel.app",
                "Access-Control-Allow-Private-Network": "true",
            }), b""),
        ):
            result = acceptance_check.check_private_network_preflight(
                "http://127.0.0.1:8766/v1/jobs",
                "https://gridsplit-kappa.vercel.app",
                "content-type,x-gridsplit-project",
            )
        self.assertEqual(result["status"], 204)
        self.assertEqual(result["private_network"], "true")

    def test_preflight_rejects_unapproved_origin(self):
        with patch.object(
            acceptance_check,
            "http_request",
            return_value=(204, {"Access-Control-Allow-Origin": "https://other.example",
                                "Access-Control-Allow-Private-Network": "true"}, b""),
        ):
            with self.assertRaises(RuntimeError):
                acceptance_check.check_private_network_preflight(
                    "http://127.0.0.1:8765/synthesize",
                    "https://gridsplit-kappa.vercel.app",
                    "content-type",
                )

    def test_inspect_mp4_rejects_non_mp4_before_invoking_ffprobe(self):
        with self.assertRaises(ValueError):
            acceptance_check.inspect_mp4(b"not an mp4", "ffprobe")


if __name__ == "__main__":
    unittest.main()
