#!/usr/bin/env python3
"""Drive-first, narration-aware image/audio alignment for GridSplit Motion Studio.

Optional Colab dependencies: faster-whisper, transformers, torch, pillow, numpy.
The analyzer preserves natural image order and uses CLIP similarity plus a
monotonic dynamic-programming alignment to place visual changes against speech.
"""
from __future__ import annotations

import json
import math
import re
import shutil
import subprocess
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}
MAX_IMAGES = 10000
MAX_UNPACKED_BYTES = 8 * 1024 * 1024 * 1024


def natural_key(value: str) -> list[Any]:
    return [int(part) if part.isdigit() else part.casefold()
            for part in re.split(r"(\d+)", value)]


def probe_duration(audio_path: Path) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(audio_path)],
        capture_output=True, text=True, check=True, timeout=60,
    )
    duration = float(result.stdout.strip())
    if not math.isfinite(duration) or duration <= 0 or duration > 24 * 60 * 60:
        raise ValueError("Audio duration is invalid or exceeds 24 hours.")
    return duration


def extract_images(archive_path: Path, destination: Path) -> list[Path]:
    destination.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive_path) as archive:
        infos = archive.infolist()
        if len(infos) > MAX_IMAGES:
            raise ValueError("The image archive contains too many ZIP entries.")
        images = []
        expanded = 0
        for info in infos:
            if info.is_dir():
                continue
            relative = PurePosixPath(info.filename)
            if relative.is_absolute() or not relative.parts or any(p in ("", ".", "..") for p in relative.parts):
                raise ValueError("Unsafe path in source ZIP: " + info.filename)
            if relative.suffix.lower() not in IMAGE_EXTENSIONS:
                continue
            if len(images) >= MAX_IMAGES:
                raise ValueError("The image archive contains more than 10,000 images.")
            unix_mode = (info.external_attr >> 16) & 0o170000
            if unix_mode == 0o120000 or (info.file_size > 0 and info.compress_size == 0):
                raise ValueError("The image archive contains an unsafe or invalid image entry.")
            if info.compress_size and info.file_size / info.compress_size > 1000:
                raise ValueError("The image archive contains an excessive compression ratio.")
            expanded += info.file_size
            if expanded > MAX_UNPACKED_BYTES:
                raise ValueError("Extracted images exceed the 8 GB safety limit.")
            target = destination.joinpath(*relative.parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(info) as source, target.open("wb") as output:
                shutil.copyfileobj(source, output, 1024 * 1024)
            images.append(target)
    images.sort(key=lambda path: natural_key(path.relative_to(destination).as_posix()))
    if not images:
        raise ValueError("No supported image files were found in the ZIP.")
    return images


def transcribe_audio(audio_path: Path, model_size: str = "small") -> tuple[list[dict[str, Any]], str]:
    # faster-whisper 1.2.1 calls av.open(..., metadata_errors="ignore").
    # PyAV 19 removed that keyword, so fail with a useful setup message rather
    # than retrying the same incompatible decoder on CPU.
    import av

    av_version = tuple(
        int(part) for part in str(getattr(av, "__version__", "0")).split(".")[:2]
    )
    if av_version >= (19, 0):
        raise RuntimeError(
            f"PyAV {getattr(av, '__version__', 'unknown')} is incompatible with "
            "faster-whisper 1.2.1. In Colab run "
            "`!pip -q install --force-reinstall --no-deps av==18.1.0`, "
            "then restart the runtime and rerun the notebook."
        )

    from faster_whisper import WhisperModel

    def collect(device: str, selected_model: str, compute_type: str):
        model = WhisperModel(selected_model, device=device, compute_type=compute_type)
        segments, info = model.transcribe(
            str(audio_path), beam_size=3, vad_filter=True, word_timestamps=False,
            condition_on_previous_text=False,
        )
        result = []
        # faster-whisper yields segments lazily, so consume inside the try block
        # to catch CUDA OOM/runtime errors and retry on CPU when necessary.
        for segment in segments:
            text = " ".join(str(segment.text).split())
            if text:
                result.append({
                    "start": max(0.0, float(segment.start)),
                    "end": max(float(segment.start) + 0.05, float(segment.end)),
                    "text": text,
                })
        return result, str(getattr(info, "language", "unknown"))

    try:
        result, language = collect("cuda", model_size, "float16")
        return result, language + " (cuda)"
    except Exception as gpu_error:
        print("GPU transcription failed; retrying with CPU int8:", str(gpu_error)[:300], flush=True)
        result, language = collect("cpu", "base", "int8")
        return result, language + " (cpu)"


def make_text_windows(segments: list[dict[str, Any]], duration: float, count: int) -> list[dict[str, Any]]:
    window_count = max(count, min(2400, int(math.ceil(duration / 6.0))))
    width = duration / window_count
    windows = []
    cursor = 0
    for index in range(window_count):
        start = index * width
        end = duration if index == window_count - 1 else (index + 1) * width
        texts = []
        while cursor < len(segments) and float(segments[cursor]["end"]) <= start:
            cursor += 1
        scan = cursor
        while scan < len(segments) and float(segments[scan]["start"]) < end:
            if float(segments[scan]["end"]) > start:
                texts.append(str(segments[scan]["text"]))
            scan += 1
        windows.append({
            "startSeconds": start,
            "endSeconds": end,
            "text": " ".join(texts).strip(),
        })
    return windows


def _clip_features(image_paths: list[Path], windows: list[dict[str, Any]], batch_size: int = 12):
    import numpy as np
    import torch
    from PIL import Image
    from transformers import CLIPModel, CLIPProcessor

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model_id = "openai/clip-vit-base-patch32"
    processor = CLIPProcessor.from_pretrained(model_id)
    model = CLIPModel.from_pretrained(model_id).to(device).eval()

    image_vectors = []
    for offset in range(0, len(image_paths), batch_size):
        batch_images = []
        for image_path in image_paths[offset:offset + batch_size]:
            with Image.open(image_path) as image:
                batch_images.append(image.convert("RGB"))
        inputs = processor(images=batch_images, return_tensors="pt")
        inputs = {key: value.to(device) for key, value in inputs.items()}
        with torch.inference_mode():
            features = model.get_image_features(**inputs)
            features = torch.nn.functional.normalize(features, dim=-1)
        image_vectors.append(features.cpu())
        del inputs, features, batch_images
        if device == "cuda":
            torch.cuda.empty_cache()

    texts = [window["text"] if window["text"] else "silence or a pause in narration" for window in windows]
    text_vectors = []
    for offset in range(0, len(texts), 64):
        inputs = processor(text=texts[offset:offset + 64], return_tensors="pt",
                           padding=True, truncation=True, max_length=77)
        inputs = {key: value.to(device) for key, value in inputs.items()}
        with torch.inference_mode():
            features = model.get_text_features(**inputs)
            features = torch.nn.functional.normalize(features, dim=-1)
        text_vectors.append(features.cpu())
        del inputs, features
        if device == "cuda":
            torch.cuda.empty_cache()

    image_matrix = torch.cat(image_vectors, dim=0)
    text_matrix = torch.cat(text_vectors, dim=0)
    return (image_matrix @ text_matrix.T).numpy(), model_id, device


def monotonic_alignment(scores):
    """Choose one increasing speech window per image, maximizing CLIP relevance."""
    import numpy as np

    image_count, window_count = scores.shape
    if window_count < image_count:
        raise ValueError("There are fewer transcript windows than images.")
    positions_i = np.linspace(0.0, 1.0, image_count)
    positions_j = np.linspace(0.0, 1.0, window_count)
    adjusted = scores.astype(np.float64) - 0.22 * np.abs(positions_i[:, None] - positions_j[None, :])
    dp = np.full((image_count, window_count), -np.inf, dtype=np.float64)
    back = np.full((image_count, window_count), -1, dtype=np.int32)
    dp[0] = adjusted[0]
    for image_index in range(1, image_count):
        best_value = -np.inf
        best_index = -1
        for window_index in range(window_count):
            previous = window_index - 1
            if previous >= 0 and dp[image_index - 1, previous] > best_value:
                best_value = dp[image_index - 1, previous]
                best_index = previous
            if best_index >= 0:
                dp[image_index, window_index] = best_value + adjusted[image_index, window_index]
                back[image_index, window_index] = best_index
    cursor = int(np.argmax(dp[-1]))
    selected = [cursor]
    for image_index in range(image_count - 1, 0, -1):
        cursor = int(back[image_index, cursor])
        selected.append(cursor)
    selected.reverse()
    return selected


def make_boundaries(selected: list[int], windows: list[dict[str, Any]], duration: float) -> list[float]:
    import numpy as np

    count = len(selected)
    even = np.linspace(0.0, duration, count + 1)
    centers = [
        (float(windows[index]["startSeconds"]) + float(windows[index]["endSeconds"])) / 2
        for index in selected
    ]
    semantic = [0.0]
    semantic.extend((centers[i - 1] + centers[i]) / 2 for i in range(1, count))
    semantic.append(duration)
    boundaries = [0.0]
    for index in range(1, count):
        boundaries.append(0.72 * semantic[index] + 0.28 * float(even[index]))
    boundaries.append(duration)

    minimum = min(0.5, duration / count * 0.35)
    for index in range(1, len(boundaries)):
        boundaries[index] = max(boundaries[index], boundaries[index - 1] + minimum)
    for index in range(len(boundaries) - 2, -1, -1):
        boundaries[index] = min(boundaries[index], boundaries[index + 1] - minimum)
    boundaries[0], boundaries[-1] = 0.0, duration
    return [float(value) for value in boundaries]


def analyze_drive_folder(
    folder_path: str,
    archive_name: str,
    audio_name: str,
    output_json: str = "gridsplit-sync.json",
    model_size: str = "small",
) -> dict[str, Any]:
    root = Path(folder_path).expanduser().resolve()
    drive_root = Path("/content/drive").resolve()
    if drive_root not in root.parents:
        raise ValueError("Choose a folder inside your mounted Google Drive.")
    archive_path = (root / archive_name).resolve()
    audio_path = (root / audio_name).resolve()
    if root not in archive_path.parents or not archive_path.is_file():
        raise FileNotFoundError("Could not find the selected image ZIP in the Drive folder.")
    if root not in audio_path.parents or not audio_path.is_file():
        raise FileNotFoundError("Could not find the selected audio file in the Drive folder.")

    duration = probe_duration(audio_path)
    work = Path("/content/gridsplit-smart-sync")
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    image_paths = extract_images(archive_path, work / "images")
    segments, language = transcribe_audio(audio_path, model_size=model_size)
    windows = make_text_windows(segments, duration, len(image_paths))

    if not any(window["text"] for window in windows):
        boundaries = [duration * index / len(image_paths) for index in range(len(image_paths) + 1)]
        selected = [min(len(windows) - 1, round((index + 0.5) * len(windows) / len(image_paths)))
                    for index in range(len(image_paths))]
        similarities = [0.0] * len(image_paths)
        method = "even-fallback-no-speech"
        clip_device = "not-used"
        clip_model = "not-used"
    else:
        scores, clip_model, clip_device = _clip_features(image_paths, windows)
        selected = monotonic_alignment(scores)
        boundaries = make_boundaries(selected, windows, duration)
        similarities = [float(scores[i, selected[i]]) for i in range(len(image_paths))]
        method = "whisper-clip-monotonic"

    records = []
    for index, image_path in enumerate(image_paths):
        window = windows[selected[index]]
        records.append({
            "fileName": image_path.relative_to(work / "images").as_posix(),
            "startSeconds": round(boundaries[index], 3),
            "endSeconds": round(boundaries[index + 1], 3),
            "matchedText": window["text"],
            "confidence": round(max(0.0, min(1.0, (similarities[index] + 1.0) / 2.0)), 4),
            "matchSimilarity": round(similarities[index], 5),
        })

    manifest = {
        "format": "gridsplit-motion-sync",
        "version": 1,
        "audio": {"fileName": audio_path.name, "durationSeconds": round(duration, 3)},
        "analysis": {
            "method": method,
            "imageCount": len(image_paths),
            "transcriptLanguage": language,
            "speechWindows": len(windows),
            "visionTextModel": clip_model,
            "visionDevice": clip_device,
        },
        "images": records,
    }
    output_path = root / output_json
    output_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return {
        "manifest": manifest,
        "outputPath": str(output_path),
        "imageCount": len(image_paths),
        "audioDurationSeconds": duration,
        "analysisMethod": method,
        "clipDevice": clip_device,
    }
