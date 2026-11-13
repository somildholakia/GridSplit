#!/usr/bin/env python3
"""Loopback-only FFmpeg renderer for GridSplit Studio. No media is sent to a cloud service."""
from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import os
import shutil
import signal
import subprocess
import tempfile
import threading
import time
import uuid
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath

MAX_ARCHIVE = 1024 * 1024 * 1024
MAX_EXPANDED = 2 * 1024 * 1024 * 1024
MAX_ENTRIES = 1610
MAX_ACTIVE_JOBS = 2
MAX_FINISHED_JOBS = 8
JOB_RETENTION_SECONDS = 6 * 60 * 60
JOBS: dict[str, dict] = {}
JOBS_LOCK = threading.RLock()
ALLOWED_ORIGINS: set[str] = set()


def prune_finished_jobs(now: float | None = None) -> None:
    """Bound completed-job metadata and remove expired render temp directories."""
    current = time.time() if now is None else now
    with JOBS_LOCK:
        finished = [
            (job_id, job)
            for job_id, job in JOBS.items()
            if job.get("status") in ("completed", "failed", "cancelled")
        ]
        finished.sort(key=lambda item: float(item[1].get("finishedAt", item[1].get("createdAt", 0))))
        expired = {
            job_id for job_id, job in finished
            if current - float(job.get("finishedAt", job.get("createdAt", current))) > JOB_RETENTION_SECONDS
        }
        retained = [job_id for job_id, _ in finished if job_id not in expired]
        overflow = set(retained[:max(0, len(retained) - MAX_FINISHED_JOBS)])
        directories = []
        for job_id in expired | overflow:
            job = JOBS.pop(job_id, None)
            if job:
                directory = Path(str(job.get("directory", ""))).parent
                if directory.name.startswith("gridsplit-render-"):
                    directories.append(directory)
    for directory in directories:
        shutil.rmtree(directory, ignore_errors=True)


def safe_path(name: str) -> PurePosixPath:
    path = PurePosixPath(name)
    if path.is_absolute() or not path.parts or any(part in ("", ".", "..") for part in path.parts):
        raise ValueError("Unsafe archive path.")
    if "\\" in name or ":" in name:
        raise ValueError("Unsafe archive path.")
    return path


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def extract_verified_archive(archive: Path, destination: Path) -> tuple[dict, dict]:
    if archive.stat().st_size > MAX_ARCHIVE:
        raise ValueError("Archive exceeds the 1 GB compressed limit.")
    with zipfile.ZipFile(archive) as bundle:
        infos = bundle.infolist()
        if len(infos) > MAX_ENTRIES:
            raise ValueError("Archive contains too many entries.")
        expanded = sum(item.file_size for item in infos)
        if expanded > MAX_EXPANDED:
            raise ValueError("Archive exceeds the 2 GB uncompressed limit.")
        for item in infos:
            safe_path(item.filename)
            unix_mode = (item.external_attr >> 16) & 0o170000
            if unix_mode == 0o120000:
                raise ValueError("Symbolic links are not allowed in project archives.")
            if item.file_size > 0 and item.compress_size == 0:
                raise ValueError("Invalid compressed media entry.")
            if item.compress_size and item.file_size / item.compress_size > 1000:
                raise ValueError("Archive contains an excessive compression ratio.")
        for name in ("manifest.json", "project.json"):
            if name not in bundle.namelist():
                raise ValueError("Archive is missing " + name + ".")
        manifest = json.loads(bundle.read("manifest.json"))
        project = json.loads(bundle.read("project.json"))
        if manifest.get("format") != "gridsplit-studio-project" or manifest.get("version") != 1:
            raise ValueError("Unsupported GridSplit archive format.")
        if not isinstance(project, dict) or project.get("id") != manifest.get("projectId"):
            raise ValueError("Project metadata does not match the archive manifest.")
        records = manifest.get("files")
        if not isinstance(records, list) or len(records) > 1600:
            raise ValueError("Invalid media manifest.")
        seen: set[str] = set()
        for record in records:
            if not isinstance(record, dict):
                raise ValueError("Invalid media manifest entry.")
            name = record.get("path")
            rel = safe_path(name if isinstance(name, str) else "")
            if len(rel.parts) != 3 or rel.parts[0] != "media" or rel.parts[1] not in ("images", "generated-audio", "mix-audio"):
                raise ValueError("Unexpected media path in manifest.")
            if name in seen:
                raise ValueError("Duplicate media path in manifest.")
            seen.add(name)
            info = bundle.getinfo(name)
            if info.is_dir() or info.file_size != record.get("sizeBytes"):
                raise ValueError("Media size does not match the manifest.")
            target = destination.joinpath(*rel.parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            with bundle.open(info) as source, target.open("wb") as output:
                shutil.copyfileobj(source, output, 1024 * 1024)
            if sha256_file(target) != record.get("sha256"):
                raise ValueError("SHA-256 verification failed for " + name + ".")
            if not isinstance(record.get("assetId"), str):
                raise ValueError("Invalid media asset ID.")
        return manifest, project


def clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def ffmpeg_expression(value: str) -> str:
    """Escape expression argument separators for FFmpeg filtergraph parsing."""
    return value.replace(",", r"\,")


def keyframe_expression(keyframes: list[dict], field: str, frame_count: int,
                        duration: float, variable: str = "on") -> str:
    """Create a bounded, piecewise-linear FFmpeg expression from normalized keyframes."""
    valid = []
    for item in keyframes:
        if not isinstance(item, dict):
            continue
        try:
            valid.append({
                "time": clamp(float(item.get("time", 0)), 0, 1),
                "value": float(item.get(field, 0)),
            })
        except (TypeError, ValueError):
            continue
    valid.sort(key=lambda item: item["time"])
    if len(valid) < 2:
        return f"{valid[0]['value']:.6f}" if valid else "0"
    scale = duration if variable == "t" else max(1, frame_count - 1)
    points = [{"position": item["time"] * scale, "value": item["value"]} for item in valid]
    result = f"{points[-1]['value']:.6f}"
    for index in range(len(points) - 2, -1, -1):
        left = points[index]
        right = points[index + 1]
        span = max(0.000001, right["position"] - left["position"])
        position = left["position"]
        end = right["position"]
        delta = right["value"] - left["value"]
        segment = f"({left['value']:.6f}+({delta:.6f})*({variable}-{position:.6f})/{span:.6f})"
        result = (
            f"if(lte({variable},{position:.6f}),{left['value']:.6f},"
            f"if(lte({variable},{end:.6f}),{segment},{result}))"
        )
    return ffmpeg_expression(result)


def particle_overlay_expressions(preset: str, intensity: float, width: int, height: int,
                                 duration: float, fps: float) -> tuple[int, int, str, str, str, str] | None:
    """Build a low-resolution transparent procedural particle plate using FFmpeg geq."""
    if preset not in ("embers", "snow", "rain", "confetti", "magic"):
        return None
    strength = clamp(float(intensity), 0, 100) / 100
    if strength <= 0:
        return None
    # Generate the particle mask at one-quarter output dimensions, then upscale
    # it with the video frame. This keeps 4K exports from evaluating dozens of
    # particle distance expressions at full frame resolution.
    plate_width = max(160, width // 4)
    plate_height = max(90, height // 4)
    count = max(5, min(18, int(4 + strength * 14)))
    radius = 1.5 + strength * 1.8
    masks: list[str] = []
    for index in range(count):
        x0 = ((index * 37 + 13) % 97) / 100 * plate_width
        y0 = ((index * 53 + 19) % 97) / 100 * plate_height
        phase = index * 1.71
        drift = 6 + (index % 6) * 3
        if preset == "embers":
            x = f"({x0:.3f}+sin(T*{0.8 + index % 4 * 0.17:.3f}+{phase:.3f})*{drift:.3f})"
            y = f"mod({y0:.3f}-T*{8 + index % 7 * 4:.3f}+{plate_height},{plate_height})"
            mask = f"max(0,1-hypot(X-{x},Y-{y})/{radius:.3f})"
            masks.append(f"({mask}*(0.45+0.55*sin(T*4+{phase:.3f})))")
        elif preset == "snow":
            x = f"({x0:.3f}+sin(T*0.7+{phase:.3f})*{drift * 1.8:.3f})"
            y = f"mod({y0:.3f}+T*{7 + index % 5 * 3:.3f},{plate_height})"
            masks.append(f"max(0,1-hypot(X-{x},Y-{y})/{radius * 1.3:.3f})")
        elif preset == "rain":
            x = f"({x0:.3f}+sin(T*0.3+{phase:.3f})*{drift * 0.35:.3f})"
            y = f"mod({y0:.3f}+T*{26 + index % 8 * 8:.3f},{plate_height})"
            masks.append(f"max(0,1-max(abs(X-{x})/1.4,abs(Y-{y})/7.5))")
        elif preset == "confetti":
            x = f"mod({x0:.3f}+T*{3 + index % 5 * 2:.3f},{plate_width})"
            y = f"mod({y0:.3f}+T*{5 + index % 6 * 3:.3f},{plate_height})"
            masks.append(f"max(0,1-max(abs(X-{x})/3.0,abs(Y-{y})/4.5))")
        else:
            x = f"({x0:.3f}+sin(T*{0.9 + index % 5 * 0.13:.3f}+{phase:.3f})*{drift * 2.0:.3f})"
            y = f"({y0:.3f}+cos(T*{0.7 + index % 4 * 0.19:.3f}+{phase:.3f})*{drift * 1.6:.3f})"
            mask = f"max(0,1-hypot(X-{x},Y-{y})/{radius * 1.5:.3f})"
            masks.append(f"({mask}*(0.35+0.65*sin(T*3+{phase:.3f})))")
    alpha = ffmpeg_expression(f"min(235,({' + '.join(masks)})*{105 + strength * 145:.3f})")
    if preset == "embers":
        red, green, blue = "255", "105+70*sin(T*3+X/25)", "15"
    elif preset == "snow":
        red, green, blue = "232", "242", "255"
    elif preset == "rain":
        red, green, blue = "105", "165", "245"
    elif preset == "confetti":
        red, green, blue = "110+145*abs(sin(X/19+T))", "100+155*abs(sin(Y/17+T*1.3))", "110+145*abs(cos((X+Y)/23-T))"
    else:
        red, green, blue = "180+65*sin(X/13+T)", "90", "255"
    return plate_width, plate_height, red, green, blue, alpha


def depth_warp_filters(depth_input: int, current_label: str, width: int, height: int,
                      duration: float, fps: float, strength: float, index: int) -> tuple[list[str], str]:
    """Build a subtle FFmpeg displace pass from a grayscale composition-depth map."""
    amount = clamp(float(strength), 0, 100) / 100
    if amount <= 0:
        return [], current_label
    plate_width = max(160, width // 4)
    plate_height = max(90, height // 4)
    # Mid-gray (128) means no displacement. Relative depth moves gently in
    # opposite directions across the clip to create a low-amplitude 2.5D warp.
    amplitude = amount * 0.72
    safe_duration = max(0.05, float(duration))
    filters = [
        f"[{depth_input}:v]scale={plate_width}:{plate_height}:flags=bilinear,format=gray,"
        f"fps={fps},trim=duration={safe_duration:.6f},setpts=PTS-STARTPTS,split=2[depthxsrc{index}][depthysrc{index}]",
        f"[depthxsrc{index}]geq=lum='128+(lum(X,Y)-128)*{amplitude:.6f}*sin(2*PI*T/{safe_duration:.6f})',"
        f"scale={width}:{height}:flags=bilinear,setpts=PTS-STARTPTS[depthx{index}]",
        f"[depthysrc{index}]geq=lum='128+(lum(X,Y)-128)*{amplitude:.6f}*cos(2*PI*T/{safe_duration:.6f})',"
        f"scale={width}:{height}:flags=bilinear,setpts=PTS-STARTPTS[depthy{index}]",
        f"{current_label}[depthx{index}][depthy{index}]displace=edge=smear[vdepthwarp{index}]",
    ]
    return filters, f"[vdepthwarp{index}]"


def encoder_available(ffmpeg: str, encoder: str) -> bool:
    try:
        encoders = subprocess.run([ffmpeg, "-hide_banner", "-encoders"], capture_output=True,
                                  text=True, timeout=15, check=True).stdout
        if encoder not in encoders:
            return False
        if encoder == "h264_nvenc":
            gpu = shutil.which("nvidia-smi")
            if not gpu:
                return False
            subprocess.run([gpu], capture_output=True, text=True, timeout=10, check=True)
            # Encoder presence and an attached GPU are not enough: run a one-frame
            # NVENC probe to catch container/driver mismatches before the real job.
            probe = subprocess.run(
                [ffmpeg, "-hide_banner", "-loglevel", "error", "-f", "lavfi",
                 "-i", "color=c=black:s=64x64:r=1:d=0.1", "-frames:v", "1",
                 "-c:v", "h264_nvenc", "-f", "null", "-"],
                capture_output=True, text=True, timeout=20,
            )
            if probe.returncode != 0:
                return False
        return True
    except (OSError, subprocess.SubprocessError):
        return False


def render_command(project: dict, manifest: dict, root: Path) -> tuple[list[str], float, dict]:
    ffmpeg = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")
    if not ffmpeg or not ffprobe:
        raise RuntimeError("FFmpeg and ffprobe must both be installed and available in PATH on this computer.")
    profile = project.get("renderProfile") or {
        "width": 1920, "height": 1080, "fps": 30, "aspectRatio": "16:9", "quality": "balanced"
    }
    width, height = int(profile.get("width", 1920)), int(profile.get("height", 1080))
    fps = float(profile.get("fps", 30))
    if not (320 <= width <= 3840 and 320 <= height <= 3840 and width % 2 == 0 and height % 2 == 0):
        raise ValueError("Output dimensions must be even and between 320 and 3840 pixels.")
    if fps not in (23.976, 24, 25, 29.97, 30, 50, 59.94, 60):
        raise ValueError("Unsupported frame rate.")
    ratio = profile.get("aspectRatio", "16:9")
    expected = {"16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1}.get(ratio)
    if expected is None or abs(width / height - expected) > 0.015:
        raise ValueError("Render profile aspect ratio does not match its dimensions.")

    requested_encoder = profile.get("encoder", "software")
    encoder = "h264_nvenc" if requested_encoder == "nvidia" and encoder_available(ffmpeg, "h264_nvenc") else "libx264"
    by_id = {item.get("assetId"): item for item in manifest.get("files", [])}
    images = {item.get("id"): item for item in project.get("imageAssets", []) if isinstance(item, dict)}
    raw_clips = [item for item in project.get("timelineClips", []) if item.get("track") == "images"]
    raw_clips.sort(key=lambda item: (float(item.get("startSeconds", 0)), int(item.get("order", 0))))
    if not raw_clips:
        raise ValueError("The project has no image clips to render.")

    edits_by_clip = {item.get("clipId"): item for item in project.get("videoClipEdits", []) if isinstance(item, dict)}
    parts: list[dict] = []
    cursor = 0.0
    for clip in raw_clips:
        start = float(clip.get("startSeconds", 0))
        duration = float(clip.get("durationSeconds", 0))
        asset_id = clip.get("assetId")
        record = by_id.get(asset_id)
        asset = images.get(asset_id)
        if not record or record.get("kind") != "image" or not asset:
            raise ValueError("An image timeline clip is missing its packaged source.")
        if not (0 <= start < 86400 and 0 < duration <= 86400):
            raise ValueError("An image clip contains invalid timing.")
        if start > cursor + 0.05:
            parts.append({"kind": "black", "duration": start - cursor, "edit": {}})
            cursor = start
        trim_before = max(0.0, cursor - start)
        effective_duration = duration - trim_before
        if effective_duration <= 0.001:
            continue
        edit = edits_by_clip.get(clip.get("id"), {})
        parallax_path = None
        parallax_asset_id = edit.get("parallaxAssetId")
        if parallax_asset_id:
            overlay_asset = images.get(parallax_asset_id)
            overlay_record = by_id.get(parallax_asset_id)
            if not overlay_asset or not overlay_record or overlay_record.get("kind") != "image":
                raise ValueError("A parallax foreground layer is missing from the project archive.")
            parallax_path = root / overlay_record["path"]
        depth_map_path = None
        depth_map_asset_id = edit.get("depthMapAssetId")
        if depth_map_asset_id:
            depth_asset = images.get(depth_map_asset_id)
            depth_record = by_id.get(depth_map_asset_id)
            if not depth_asset or not depth_record or depth_record.get("kind") != "image":
                raise ValueError("A depth-map layer is missing from the project archive.")
            depth_map_path = root / depth_record["path"]
        keyframes = edit.get("keyframes")
        if keyframes is not None:
            if not isinstance(keyframes, list) or not (2 <= len(keyframes) <= 32):
                raise ValueError("A clip must contain between 2 and 32 valid motion keyframes.")
            for keyframe in keyframes:
                if not isinstance(keyframe, dict):
                    raise ValueError("A motion keyframe is invalid.")
                if not (0 <= float(keyframe.get("time", -1)) <= 1
                        and 1 <= float(keyframe.get("scale", 0)) <= 1.5
                        and 0 <= float(keyframe.get("panX", -1)) <= 1
                        and 0 <= float(keyframe.get("panY", -1)) <= 1
                        and -25 <= float(keyframe.get("rotation", 999)) <= 25):
                    raise ValueError("A motion keyframe contains an out-of-range transform.")
        parts.append({
            "kind": "image",
            "path": root / record["path"],
            "duration": effective_duration,
            "edit": edit,
            "parallaxPath": parallax_path,
            "depthMapPath": depth_map_path,
        })
        cursor = max(cursor, start + duration)
    video_duration = cursor
    if video_duration <= 0:
        raise ValueError("The image timeline has no renderable duration.")

    command = [ffmpeg, "-hide_banner", "-y", "-loglevel", "warning", "-progress", "pipe:1", "-nostats"]
    filters: list[str] = []
    stream_labels: list[str] = []
    input_index = 0
    for index, part in enumerate(parts):
        duration = part["duration"]
        if part["kind"] == "black":
            command += ["-f", "lavfi", "-i", f"color=c=black:s={width}x{height}:r={fps}:d={duration:.6f}"]
            filters.append(f"[{input_index}:v]trim=duration={duration:.6f},setpts=PTS-STARTPTS,format=yuv420p,setsar=1[v{index}]")
            stream_labels.append(f"[v{index}]")
            input_index += 1
            continue

        edit = part["edit"]
        command += ["-loop", "1", "-framerate", str(fps), "-t", f"{duration:.6f}", "-i", str(part["path"])]
        base_input = input_index
        input_index += 1
        effect = edit.get("effect", "none")
        zoom = clamp(float(edit.get("zoom", 1.12)), 1.0, 1.5)
        frames = max(1, int(duration * fps))
        keyframes = edit.get("keyframes") or []
        base = f"[{base_input}:v]scale={width}:{height}:force_original_aspect_ratio=increase,setsar=1"
        if keyframes:
            rotation = keyframe_expression(keyframes, "rotation", frames, duration, "t")
            base += f",rotate=angle='{rotation}*PI/180':ow=iw:oh=ih:c=black"
        base += f",crop={width}:{height},fps={fps},trim=duration={duration:.6f},setpts=PTS-STARTPTS"
        if keyframes:
            z = keyframe_expression(keyframes, "scale", frames, duration)
            pan_x = keyframe_expression(keyframes, "panX", frames, duration)
            pan_y = keyframe_expression(keyframes, "panY", frames, duration)
            x = f"(iw-iw/zoom)*({pan_x})"
            y = f"(ih-ih/zoom)*({pan_y})"
            base += f",zoompan=z='{z}':x='{x}':y='{y}':d=1:s={width}x{height}:fps={fps}"
        elif effect in ("ken-burns", "zoom-in", "zoom-out", "pan-left", "pan-right"):
            max_zoom = zoom if effect != "ken-burns" else max(zoom, 1.12)
            if effect == "zoom-out":
                z = f"max(1.0,{max_zoom:.5f}-on*{(max_zoom - 1.0) / frames:.8f})"
            else:
                z = f"min(zoom+{(max_zoom - 1.0) / frames:.8f},{max_zoom:.5f})"
            x = f"(iw-iw/zoom)*on/{frames}" if effect == "pan-right" else (
                f"(iw-iw/zoom)*(1-on/{frames})" if effect == "pan-left" else "iw/2-(iw/zoom/2)"
            )
            base += f",zoompan=z='{z}':x='{x}':y='ih/2-(ih/zoom/2)':d=1:s={width}x{height}:fps={fps}"
        filters.append(base + f",trim=duration={duration:.6f},setpts=PTS-STARTPTS,format=yuv420p[vbase{index}]")
        current_label = f"[vbase{index}]"

        if part.get("parallaxPath"):
            depth_input = input_index
            command += ["-loop", "1", "-framerate", str(fps), "-t", f"{duration:.6f}", "-i", str(part["parallaxPath"])]
            input_index += 1
            amount = clamp(float(edit.get("parallaxAmount", 45)), 0, 100) / 100
            shift_x = width * 0.04 * amount
            shift_y = height * 0.025 * amount
            filters.append(
                f"[{depth_input}:v]scale={width}:{height}:force_original_aspect_ratio=decrease,"
                f"format=rgba,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black@0.0,"
                f"fps={fps},trim=duration={duration:.6f},setpts=PTS-STARTPTS[vdepth{index}]"
            )
            x_expr = ffmpeg_expression(f"(W-w)/2+sin(2*PI*t/{duration:.6f})*{shift_x:.4f}")
            y_expr = ffmpeg_expression(f"(H-h)/2+cos(2*PI*t/{duration:.6f})*{shift_y:.4f}")
            filters.append(
                f"{current_label}[vdepth{index}]overlay=x='{x_expr}':y='{y_expr}':eval=frame:shortest=1:format=auto[vpara{index}]"
            )
            current_label = f"[vpara{index}]"

        if part.get("depthMapPath"):
            depth_input = input_index
            command += ["-loop", "1", "-framerate", str(fps), "-t", f"{duration:.6f}", "-i", str(part["depthMapPath"])]
            input_index += 1
            depth_filters, current_label = depth_warp_filters(
                depth_input,
                current_label,
                width,
                height,
                duration,
                fps,
                clamp(float(edit.get("depthMotionAmount", 35)), 0, 100),
                index,
            )
            filters.extend(depth_filters)

        particle = particle_overlay_expressions(
            str(edit.get("particlePreset", "none")),
            clamp(float(edit.get("particleIntensity", 55)), 0, 100),
            width, height, duration, fps,
        )
        if particle:
            plate_width, plate_height, red, green, blue, alpha = particle
            particle_input = input_index
            command += ["-f", "lavfi", "-i",
                        f"color=c=black@0.0:s={plate_width}x{plate_height}:r={fps}:d={duration:.6f}"]
            input_index += 1
            filters.append(
                f"[{particle_input}:v]format=rgba,geq=r='{red}':g='{green}':b='{blue}':a='{alpha}',"
                f"scale={width}:{height}:flags=bicubic,setpts=PTS-STARTPTS[vparticles{index}]"
            )
            filters.append(
                f"{current_label}[vparticles{index}]overlay=shortest=1:format=auto[vfx{index}]"
            )
            current_label = f"[vfx{index}]"

        filters.append(f"{current_label}format=yuv420p,setsar=1[v{index}]")
        stream_labels.append(f"[v{index}]")

    current = stream_labels[0]
    running_duration = parts[0]["duration"]
    transition_extra = 0.0
    for index in range(1, len(parts)):
        label = f"[vx{index}]"
        current_edit = parts[index]["edit"]
        previous_edit = parts[index - 1]["edit"]
        transition = current_edit.get("transitionIn", "cut")
        if transition == "cut":
            transition = previous_edit.get("transitionOut", "cut")
        transition_name = {
            "fade": "fade", "dissolve": "dissolve", "wipe-left": "wipeleft", "wipe-right": "wiperight"
        }.get(transition)
        if transition_name:
            requested = float(current_edit.get("transitionDurationSeconds", previous_edit.get("transitionDurationSeconds", 0.5)))
            fade = clamp(requested, 0.05, min(5.0, parts[index]["duration"] / 2, running_duration / 2))
            offset = max(0.0, running_duration - fade)
            filters.append(f"{current}{stream_labels[index]}xfade=transition={transition_name}:duration={fade:.6f}:offset={offset:.6f}{label}")
            transition_extra += fade
            running_duration += parts[index]["duration"] - fade
        else:
            filters.append(f"{current}{stream_labels[index]}concat=n=2:v=1:a=0{label}")
            running_duration += parts[index]["duration"]
        current = label
    if transition_extra > 0:
        filters.append(f"{current}tpad=stop_mode=clone:stop_duration={transition_extra:.6f},trim=duration={video_duration:.6f},setpts=PTS-STARTPTS[vout]")
    else:
        filters.append(f"{current}trim=duration={video_duration:.6f},setpts=PTS-STARTPTS[vout]")

    tracks = project.get("audioMixTracks", [])
    if not isinstance(tracks, list):
        tracks = []
    defaults = [
        {"id": "default-narration", "kind": "narration", "volume": 1, "muted": False, "solo": False, "fadeInSeconds": 0, "fadeOutSeconds": 0},
        {"id": "default-dialogue", "kind": "dialogue", "volume": 1, "muted": False, "solo": False, "fadeInSeconds": 0, "fadeOutSeconds": 0},
        {"id": "default-music", "kind": "music", "volume": 0.35, "muted": False, "solo": False, "fadeInSeconds": 1, "fadeOutSeconds": 2},
        {"id": "default-sfx", "kind": "sfx", "volume": 0.8, "muted": False, "solo": False, "fadeInSeconds": 0, "fadeOutSeconds": 0},
    ]
    by_kind = {item.get("kind"): item for item in tracks if isinstance(item, dict)}
    by_kind = {**{item["kind"]: item for item in defaults}, **by_kind}
    solo_active = any(item.get("solo") and not item.get("muted") for item in by_kind.values())
    enabled = {
        item.get("id") for item in by_kind.values()
        if not item.get("muted") and (not solo_active or item.get("solo"))
    }
    mix_tracks = {item.get("id"): item for item in by_kind.values()}

    scene_order = {scene.get("id"): index for index, scene in enumerate(project.get("scenes", []))}
    audio_clips = {
        clip.get("sceneId"): clip for clip in project.get("timelineClips", [])
        if clip.get("track") == "audio"
    }
    files_by_id = {item.get("assetId"): item for item in manifest.get("files", [])}
    audio_events: list[dict] = []
    offsets: dict[str, float] = {}
    segments = sorted(
        [item for item in project.get("audioSegments", []) if item.get("status") == "ready"],
        key=lambda item: (scene_order.get(item.get("sceneId"), 999999),
                          next((i for i, block in enumerate(next((s.get("blocks", []) for s in project.get("scenes", []) if s.get("id") == item.get("sceneId")), [])) if block.get("id") == item.get("blockId")), 999999)),
    )
    for segment in segments:
        record = files_by_id.get(segment.get("id"))
        scene_id = segment.get("sceneId")
        scene = next((item for item in project.get("scenes", []) if item.get("id") == scene_id), {})
        block = next((item for item in scene.get("blocks", []) if item.get("id") == segment.get("blockId")), {})
        kind = "dialogue" if block.get("kind") == "dialogue" else "narration"
        track = next((item for item in by_kind.values() if item.get("kind") == kind), defaults[0 if kind == "narration" else 1])
        if not record or record.get("kind") != "generated-audio" or track.get("id") not in enabled:
            continue
        clip = audio_clips.get(scene_id, {})
        duration = float(segment.get("sampleCount", 0)) / float(segment.get("sampleRate", 1))
        if duration <= 0:
            duration = float(segment.get("durationSeconds", 0))
        start = float(clip.get("startSeconds", 0)) + offsets.get(scene_id, 0)
        offsets[scene_id] = offsets.get(scene_id, 0) + duration
        audio_events.append({"path": root / record["path"], "start": start, "duration": duration, "track": track})

    for asset in project.get("mixAssets", []):
        if not isinstance(asset, dict):
            continue
        track = mix_tracks.get(asset.get("trackId"))
        record = files_by_id.get(asset.get("id"))
        if track and track.get("id") in enabled and record and record.get("kind") == "mix-audio":
            audio_events.append({
                "path": root / record["path"],
                "start": float(asset.get("startSeconds", 0)),
                "duration": min(float(asset.get("durationSeconds", video_duration)), video_duration),
                "track": track,
            })

    audio_indices: list[str] = []
    for event in audio_events:
        if event["start"] >= video_duration or event["duration"] <= 0:
            continue
        command += ["-i", str(event["path"])]
        index = input_index
        input_index += 1
        duration = min(event["duration"], video_duration - event["start"])
        track = event["track"]
        gain = clamp(float(track.get("volume", 1)), 0, 2)
        fade_in = clamp(float(track.get("fadeInSeconds", 0)), 0, duration)
        fade_out = clamp(float(track.get("fadeOutSeconds", 0)), 0, duration)
        delay = max(0, int(event["start"] * 1000))
        label = f"[a{len(audio_indices)}]"
        audio_chain = [
            f"atrim=duration={duration:.6f}",
            "asetpts=PTS-STARTPTS",
            f"volume={gain:.4f}",
        ]
        if fade_in > 0:
            audio_chain.append(f"afade=t=in:st=0:d={fade_in:.6f}")
        if fade_out > 0:
            audio_chain.append(f"afade=t=out:st={max(0, duration - fade_out):.6f}:d={fade_out:.6f}")
        audio_chain.append(f"adelay={delay}|{delay}:all=1")
        filters.append(f"[{index}:a]{','.join(audio_chain)}{label}")
        audio_indices.append(label)

    if audio_indices:
        joined = "".join(audio_indices)
        filters.append(f"{joined}amix=inputs={len(audio_indices)}:duration=longest:dropout_transition=0,alimiter=limit=0.97,atrim=duration={video_duration:.6f}[aout]")
    else:
        command += ["-f", "lavfi", "-t", f"{video_duration:.6f}", "-i", "anullsrc=r=48000:cl=stereo"]
        filters.append(f"[{input_index}:a]atrim=duration={video_duration:.6f},asetpts=PTS-STARTPTS[aout]")

    command += [
        "-filter_complex", ";".join(filters),
        "-map", "[vout]", "-map", "[aout]",
        "-t", f"{video_duration:.6f}",
        "-r", str(fps), "-c:v", encoder, "-pix_fmt", "yuv420p",
    ]
    if encoder == "h264_nvenc":
        command += ["-preset", "p5", "-rc", "vbr", "-cq", "22", "-b:v", "0"]
    else:
        command += [
            "-preset", "medium",
            "-crf", {"high": "18", "balanced": "21", "compact": "26"}.get(profile.get("quality"), "21"),
        ]
    command += [
        "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
        str(root / "output.mp4"),
    ]
    return command, video_duration, {
        "width": width, "height": height, "fps": fps, "ffprobe": ffprobe, "encoder": encoder,
    }

def _run_render_process(job_id: str, command: list[str], duration: float, message: str) -> int:
    """Run one FFmpeg attempt while reporting real progress from FFmpeg itself."""
    with JOBS_LOCK:
        job = JOBS[job_id]
        job["message"] = message
    process = subprocess.Popen(
        command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, bufsize=1,
    )
    with JOBS_LOCK:
        job["process"] = process
    if process.stdout:
        for line in process.stdout:
            if job["cancel"].is_set():
                process.terminate()
                break
            line = line.strip()
            if line.startswith("out_time_ms="):
                try:
                    seconds = int(line.split("=", 1)[1]) / 1_000_000
                    progress = min(94, max(2, int(seconds / duration * 92)))
                    with JOBS_LOCK:
                        job["progress"] = progress
                except (ValueError, ZeroDivisionError):
                    pass
            elif line.startswith("progress=end"):
                with JOBS_LOCK:
                    job["progress"] = 95
            elif line:
                with JOBS_LOCK:
                    job["lastLog"] = (job.get("lastLog", "") + line + "\\n")[-4000:]
    return process.wait()


def execute_job(job_id: str) -> None:
    with JOBS_LOCK:
        job = JOBS[job_id]
        if job["cancel"].is_set():
            job["status"] = "cancelled"
            job["message"] = "Render was cancelled before FFmpeg started."
            job["finishedAt"] = time.time()
            return
        job["status"] = "running"
        job["progress"] = 2
        job["message"] = "Validating the render environment and project media."
    try:
        root = Path(job["directory"])
        command, duration, profile = render_command(job["project"], job["manifest"], root)
        return_code = _run_render_process(
            job_id, command, duration,
            "FFmpeg is rendering with " + profile["encoder"] + ".",
        )

        if job["cancel"].is_set():
            with JOBS_LOCK:
                job["status"] = "cancelled"
                job["message"] = "Render was cancelled."
            return

        # An NVENC probe can pass and the real job can still fail because of
        # driver/runtime resource limits. Retry the same archive with libx264.
        if return_code != 0 and profile.get("encoder") == "h264_nvenc":
            partial_output = root / "output.mp4"
            partial_output.unlink(missing_ok=True)
            with JOBS_LOCK:
                job["progress"] = 2
                job["message"] = "NVENC failed during the render. Retrying with CPU libx264."
            job["project"].setdefault("renderProfile", {})["encoder"] = "software"
            command, duration, profile = render_command(job["project"], job["manifest"], root)
            return_code = _run_render_process(
                job_id, command, duration,
                "GPU encoding failed; retrying on CPU with libx264.",
            )

        if job["cancel"].is_set():
            with JOBS_LOCK:
                job["status"] = "cancelled"
                job["message"] = "Render was cancelled."
            return
        if return_code != 0:
            raise RuntimeError(
                "FFmpeg failed. Check the imported media and codec support. "
                + job.get("lastLog", "")[-1200:]
            )

        output = root / "output.mp4"
        if not output.is_file() or output.stat().st_size < 1024:
            raise RuntimeError("FFmpeg completed without producing a valid MP4.")
        probe = subprocess.run(
            [profile["ffprobe"], "-v", "error", "-show_entries",
             "format=duration,format_name:stream=codec_type,codec_name,width,height,r_frame_rate",
             "-of", "json", str(output)],
            capture_output=True, text=True, timeout=60, check=True,
        )
        report = json.loads(probe.stdout)
        streams = report.get("streams", [])
        video = next((item for item in streams if item.get("codec_type") == "video"), None)
        audio = next((item for item in streams if item.get("codec_type") == "audio"), None)
        actual_duration = float(report.get("format", {}).get("duration", 0))
        if not video or not audio or video.get("codec_name") != "h264" or audio.get("codec_name") != "aac":
            raise RuntimeError("Output validation failed: expected H.264 video and AAC audio streams.")
        if "mp4" not in report.get("format", {}).get("format_name", ""):
            raise RuntimeError("Output validation failed: the container is not MP4.")
        try:
            rate_parts = str(video.get("r_frame_rate", "0/1")).split("/")
            actual_fps = float(rate_parts[0]) / float(rate_parts[1])
        except (ValueError, ZeroDivisionError):
            actual_fps = 0.0
        if abs(actual_fps - profile["fps"]) > 0.02:
            raise RuntimeError("Output validation failed: frame rate does not match the selected profile.")
        if int(video.get("width", 0)) != profile["width"] or int(video.get("height", 0)) != profile["height"]:
            raise RuntimeError("Output validation failed: rendered dimensions do not match the selected profile.")
        if abs(actual_duration - duration) > max(0.25, 2 / profile["fps"]):
            raise RuntimeError("Output validation failed: MP4 duration differs from the timeline.")
        with JOBS_LOCK:
            job["status"] = "completed"
            job["progress"] = 100
            job["message"] = (
                "MP4 validated by ffprobe using " + profile["encoder"]
                + ": H.264, AAC, dimensions, frame rate and duration."
            )
            job["output"] = {
                "filename": "output.mp4", "bytes": output.stat().st_size,
                "durationSeconds": actual_duration, "width": profile["width"],
                "height": profile["height"], "fps": profile["fps"],
                "videoCodec": "h264", "audioCodec": "aac",
                "encoder": profile["encoder"],
            }
    except Exception as error:
        with JOBS_LOCK:
            if job["cancel"].is_set():
                job["status"] = "cancelled"
                job["message"] = "Render was cancelled."
            else:
                job["status"] = "failed"
                job["error"] = str(error)
                job["message"] = "Render failed."
    finally:
        with JOBS_LOCK:
            process = job.get("process")
            if process and process.poll() is None:
                process.kill()
            job.pop("process", None)
            if job.get("status") in ("completed", "failed", "cancelled"):
                job["finishedAt"] = time.time()


class Handler(BaseHTTPRequestHandler):
    server_version = "GridSplitLocalRenderer/1.0"

    def log_message(self, fmt: str, *args) -> None:
        print("[GridSplit renderer] " + fmt % args, flush=True)

    def _origin(self) -> str | None:
        return self.headers.get("Origin")

    def _host_allowed(self) -> bool:
        host = self.headers.get("Host", "").split(":", 1)[0].strip("[]").lower()
        return host in ("127.0.0.1", "localhost", "::1")

    def _cors(self) -> None:
        origin = self._origin()
        if origin and origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-GridSplit-Project")
            if self.headers.get("Access-Control-Request-Private-Network") == "true":
                self.send_header("Access-Control-Allow-Private-Network", "true")

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _check_request(self) -> bool:
        if not self._host_allowed():
            self._json(403, {"error": "Host header rejected. Use the loopback renderer address."})
            return False
        origin = self._origin()
        if origin and origin not in ALLOWED_ORIGINS:
            self._json(403, {"error": "This browser origin is not on the renderer allowlist. Restart with --allow-origin for this exact origin."})
            return False
        return True

    def do_OPTIONS(self) -> None:
        if not self._check_request():
            return
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:
        if not self._check_request():
            return
        prune_finished_jobs()
        if self.path == "/v1/health":
            self._json(200, {"ready": bool(shutil.which("ffmpeg") and shutil.which("ffprobe")),
                             "ffmpeg": shutil.which("ffmpeg"), "ffprobe": shutil.which("ffprobe"),
                             "message": "Renderer runs only on this computer."})
            return
        pieces = self.path.strip("/").split("/")
        if len(pieces) >= 3 and pieces[:2] == ["v1", "jobs"]:
            job_id = pieces[2]
            with JOBS_LOCK:
                job = JOBS.get(job_id)
                if not job:
                    self._json(404, {"error": "Render job not found."})
                    return
                snapshot = {key: job.get(key) for key in ("id", "status", "progress", "message", "error", "output")}
            if len(pieces) == 4 and pieces[3] == "output":
                if snapshot["status"] != "completed":
                    self._json(409, {"error": "Render output is not ready."})
                    return
                output = Path(job["directory"]) / "output.mp4"
                self.send_response(200)
                self.send_header("Content-Type", "video/mp4")
                self.send_header("Content-Length", str(output.stat().st_size))
                self._cors()
                self.end_headers()
                with output.open("rb") as handle:
                    shutil.copyfileobj(handle, self.wfile)
                return
            self._json(200, snapshot)
            return
        self._json(404, {"error": "Route not found."})

    def do_POST(self) -> None:
        if not self._check_request():
            return
        prune_finished_jobs()
        if self.path != "/v1/jobs":
            self._json(404, {"error": "Route not found."})
            return
        with JOBS_LOCK:
            active_count = sum(job.get("status") in ("queued", "running") for job in JOBS.values())
        if active_count >= MAX_ACTIVE_JOBS:
            self._json(429, {"error": "The local renderer is already running its maximum of two jobs. Wait for one to finish."})
            return
        directory: Path | None = None
        registered = False
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_ARCHIVE:
                raise ValueError("Upload must be a non-empty project ZIP under 1 GB.")
            if not self.headers.get("Content-Type", "").startswith("application/zip"):
                raise ValueError("Upload must use application/zip content type.")
            project_id = self.headers.get("X-GridSplit-Project", "")
            directory = Path(tempfile.mkdtemp(prefix="gridsplit-render-"))
            archive = directory / "project.zip"
            remaining = length
            with archive.open("wb") as handle:
                while remaining:
                    chunk = self.rfile.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise ValueError("Upload ended before the declared content length.")
                    handle.write(chunk)
                    remaining -= len(chunk)
            manifest, project = extract_verified_archive(archive, directory / "project")
            if project_id and project_id != manifest.get("projectId"):
                raise ValueError("Project ID header does not match the archive.")
            job_id = uuid.uuid4().hex
            job = {
                "id": job_id, "status": "queued", "progress": 0, "message": "Project archive accepted.",
                "error": None, "output": None, "directory": str(directory / "project"),
                "manifest": manifest, "project": project, "cancel": threading.Event(), "process": None,
                "createdAt": time.time(),
            }
            with JOBS_LOCK:
                active_count = sum(item.get("status") in ("queued", "running") for item in JOBS.values())
                if active_count >= MAX_ACTIVE_JOBS:
                    raise RuntimeError("The local renderer is already running its maximum of two jobs. Wait for one to finish.")
                JOBS[job_id] = job
                registered = True
            worker = threading.Thread(target=execute_job, args=(job_id,), daemon=True)
            worker.start()
            self._json(202, {key: job.get(key) for key in ("id", "status", "progress", "message")})
        except Exception as error:
            if directory is not None and not registered:
                shutil.rmtree(directory, ignore_errors=True)
            self._json(400, {"error": str(error)})

    def do_DELETE(self) -> None:
        if not self._check_request():
            return
        pieces = self.path.strip("/").split("/")
        if len(pieces) != 3 or pieces[:2] != ["v1", "jobs"]:
            self._json(404, {"error": "Route not found."})
            return
        with JOBS_LOCK:
            job = JOBS.get(pieces[2])
            if not job:
                self._json(404, {"error": "Render job not found."})
                return
            job["cancel"].set()
            process = job.get("process")
            if process and process.poll() is None:
                process.terminate()
            if job["status"] in ("queued", "running"):
                job["status"] = "cancelled"
                job["message"] = "Cancellation requested."
        self._json(200, {"id": pieces[2], "status": "cancelled"})


def main() -> None:
    parser = argparse.ArgumentParser(description="GridSplit Studio local FFmpeg renderer")
    parser.add_argument("--host", default="127.0.0.1", choices=["127.0.0.1"], help="Renderer binds to loopback only.")
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--allow-origin", action="append", default=[], help="Exact browser origin allowed to access this local renderer.")
    args = parser.parse_args()
    if not (1024 <= args.port <= 65535):
        parser.error("Port must be between 1024 and 65535.")
    if not args.allow_origin:
        parser.error("Add the exact GridSplit browser origin with --allow-origin.")
    global ALLOWED_ORIGINS
    ALLOWED_ORIGINS = set(args.allow_origin)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.daemon_threads = True
    print("GridSplit local renderer listening on http://127.0.0.1:" + str(args.port), flush=True)
    print("Allowed browser origins: " + ", ".join(sorted(ALLOWED_ORIGINS)), flush=True)
    print("FFmpeg: " + str(shutil.which("ffmpeg")) + " | ffprobe: " + str(shutil.which("ffprobe")), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Stopping GridSplit local renderer.", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
