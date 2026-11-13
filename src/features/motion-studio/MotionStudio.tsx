import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown, ArrowUp, AudioLines, CheckCircle2, Clapperboard, FileAudio,
  ImagePlus, Loader2, RefreshCw, ShieldCheck, Sparkles, Square,
  Trash2, Upload, WandSparkles, KeyRound, Layers3, Flame, Cloud, CloudSnow, CloudRain,
  Sparkles as SparklesIcon, Play, Pause, Volume2, VolumeX, Maximize2, X,
} from "lucide-react";
import type { StudioProject, ProjectImageAsset, ProjectTimelineClip } from "../../lib/projectStore";
import type {
  AspectRatio, AudioMixTrack, ImageEffectKind, MixAudioAsset,
  MotionKeyframe, ParticlePreset, RenderProfile, TransitionKind, VideoClipEdit,
} from "../../domain/production";
import {
  downloadRenderedVideo, renderProjectLocally, type LocalRenderJob,
} from "../../lib/localRenderer";
import {
  deleteProjectImageBlob, deleteProjectMedia, saveProjectImageBlob, saveProjectMedia,
} from "../../lib/projectMediaStore";
import { buildEvenImageTimeline, buildMotionPreviewSchedule, getMotionPreviewFrameState, moveSequenceItem } from "./motionTiming";
import { buildColabNotebook, downloadMotionPackage } from "./colabExport";
import { checkColabRenderer, renderProjectOnColab, type ColabProgress } from "../../lib/colabRenderer";
import { createCompositionDepthMap, depthMapToImageData } from "./depthEstimation";
import { createPresetKeyframes, insertMotionKeyframe, resolveParticleSettings, sampleMotionKeyframes } from "./motionLayers";

import "./motion-studio.css";

type MotionForeground = { asset: ProjectImageAsset; file: File; objectUrl: string };
type MotionImage = {
  asset: ProjectImageAsset;
  file: File;
  objectUrl: string;
  foreground?: MotionForeground;
  depthMap?: MotionForeground;
  depthFocus?: { x: number; y: number };
  depthMotionAmount?: number;
  keyframes: MotionKeyframe[];
  customKeyframes: boolean;
  particlePreset?: ParticlePreset;
  particleIntensity?: number;
};

type OutputSize = "720p" | "1080p";
const EFFECTS: Array<{ value: ImageEffectKind; label: string }> = [
  { value: "ken-burns", label: "Ken Burns · cinematic push" },
  { value: "zoom-in", label: "Slow zoom in" },
  { value: "zoom-out", label: "Slow zoom out" },
  { value: "pan-left", label: "Camera pan left" },
  { value: "pan-right", label: "Camera pan right" },
  { value: "none", label: "Static image" },
];

const TRANSITIONS: Array<{ value: TransitionKind; label: string }> = [
  { value: "dissolve", label: "Dissolve" },
  { value: "fade", label: "Fade" },
  { value: "wipe-left", label: "Wipe left" },
  { value: "wipe-right", label: "Wipe right" },
  { value: "cut", label: "Hard cut" },
];

function sortNaturally(items: MotionImage[]): MotionImage[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return [...items].sort((a, b) => collator.compare(a.asset.name, b.asset.name))
    .map((item, order) => ({ ...item, asset: { ...item.asset, order, sequenceNumber: order + 1 } }));
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00.00";
  const centiseconds = Math.round(seconds * 100);
  const minutes = Math.floor(centiseconds / 6000);
  const remaining = (centiseconds % 6000) / 100;
  return minutes + ":" + remaining.toFixed(2).padStart(5, "0");
}

function inferAudioMime(file: File): string {
  if (file.type.startsWith("audio/")) return file.type;
  const extension = file.name.toLowerCase().split(".").pop();
  if (extension === "wav") return "audio/wav";
  if (extension === "m4a" || extension === "mp4") return "audio/mp4";
  if (extension === "ogg" || extension === "opus") return "audio/ogg";
  if (extension === "flac") return "audio/flac";
  return "audio/mpeg";
}

function imageDimensions(file: File, objectUrl: string): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file).then((bitmap) => {
      const result = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return result;
    }).catch(() => imageDimensionsFromElement(objectUrl));
  }
  return imageDimensionsFromElement(objectUrl);
}

function imageDimensionsFromElement(objectUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("An image could not be decoded. Use PNG, JPEG or WebP files."));
    image.src = objectUrl;
  });
}

function drawMotionFrame(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  effect: ImageEffectKind,
  progress: number,
  zoomStrength: number,
  keyframes?: MotionKeyframe[],
): void {
  const context = canvas.getContext("2d");
  if (!context || !image.complete || !image.naturalWidth || !image.naturalHeight) return;
  const width = canvas.width;
  const height = canvas.height;
  const strength = Math.max(0, Math.min(1, (zoomStrength - 1) / 0.5));
  const cover = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  let zoom = effect === "none" ? 1 : 1.04 + strength * 0.08;
  let offsetX = 0;
  let offsetY = 0;
  if (effect === "ken-burns" || effect === "zoom-in") zoom = 1.04 + strength * 0.08 + progress * (0.09 + strength * 0.08);
  if (effect === "zoom-out") zoom = 1.16 + strength * 0.12 - progress * (0.09 + strength * 0.08);
  if (effect === "pan-left") {
    zoom = 1.08 + strength * 0.06;
    offsetX = (0.5 - progress) * width * 0.11;
  }
  if (effect === "pan-right") {
    zoom = 1.08 + strength * 0.06;
    offsetX = (progress - 0.5) * width * 0.11;
  }
  let rotation = 0;
  if (keyframes?.length) {
    const transform = sampleMotionKeyframes(keyframes, progress);
    zoom = transform.scale;
    offsetX = (0.5 - transform.panX) * width * 0.14;
    offsetY = (0.5 - transform.panY) * height * 0.14;
    rotation = transform.rotation * Math.PI / 180;
  }
  const drawWidth = image.naturalWidth * cover * zoom;
  const drawHeight = image.naturalHeight * cover * zoom;
  context.fillStyle = "#070a10";
  context.fillRect(0, 0, width, height);
  context.save();
  context.translate(width / 2 + offsetX, height / 2 + offsetY);
  context.rotate(rotation);
  context.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  context.restore();
}

function drawParticlePreview(
  canvas: HTMLCanvasElement,
  preset: ParticlePreset,
  progress: number,
  intensity: number,
): void {
  if (preset === "none" || intensity <= 0) return;
  const context = canvas.getContext("2d");
  if (!context) return;
  const count = Math.max(5, Math.round(7 + intensity * 0.2));
  const width = canvas.width;
  const height = canvas.height;
  context.save();
  for (let index = 0; index < count; index += 1) {
    const seedX = ((index * 37 + 13) % 97) / 97;
    const seedY = ((index * 53 + 19) % 97) / 97;
    const phase = index * 1.71;
    let x = seedX * width;
    let y = seedY * height;
    const size = 2 + (index % 4) * 0.9;
    const alpha = (0.28 + ((index * 7) % 10) / 20) * (intensity / 100);
    if (preset === "embers") {
      x += Math.sin(progress * Math.PI * 2 + phase) * width * 0.025;
      y = ((seedY - progress * (0.35 + (index % 5) * 0.05) + 1) % 1) * height;
      context.fillStyle = "rgba(255," + (105 + (index % 4) * 30) + ",24," + alpha + ")";
      context.shadowColor = "rgba(255,100,15,.7)";
      context.shadowBlur = 9;
      context.beginPath();
      context.arc(x, y, size, 0, Math.PI * 2);
      context.fill();
    } else if (preset === "snow") {
      x += Math.sin(progress * Math.PI * 4 + phase) * width * 0.025;
      y = ((seedY + progress * (0.35 + (index % 5) * 0.06)) % 1) * height;
      context.fillStyle = "rgba(236,246,255," + alpha + ")";
      context.beginPath();
      context.arc(x, y, size * 0.8, 0, Math.PI * 2);
      context.fill();
    } else if (preset === "rain") {
      x += Math.sin(progress * Math.PI * 2 + phase) * width * 0.008;
      y = ((seedY + progress * (1.2 + (index % 5) * 0.25)) % 1) * height;
      context.strokeStyle = "rgba(133,184,255," + alpha + ")";
      context.lineWidth = Math.max(1, size * 0.55);
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x - 3, y + 14 + size * 2);
      context.stroke();
    } else if (preset === "confetti") {
      x = ((seedX + progress * (0.45 + (index % 3) * 0.1)) % 1) * width;
      y = ((seedY + progress * (0.55 + (index % 4) * 0.08)) % 1) * height;
      const palette = ["#ff5468", "#ffd166", "#73e2c2", "#7ba7ff", "#c88cff"];
      context.fillStyle = palette[index % palette.length];
      context.globalAlpha = alpha + 0.2;
      context.translate(x, y);
      context.rotate(progress * Math.PI * 2 + phase);
      context.fillRect(-size, -size * 0.6, size * 2.2, size * 1.2);
      context.setTransform(1, 0, 0, 1, 0, 0);
    } else if (preset === "magic") {
      x += Math.sin(progress * Math.PI * 3 + phase) * width * 0.055;
      y += Math.cos(progress * Math.PI * 2 + phase) * height * 0.04;
      context.fillStyle = "rgba(190,132,255," + alpha + ")";
      context.shadowColor = "rgba(180,90,255,.85)";
      context.shadowBlur = 12;
      context.beginPath();
      context.arc(x, y, size * 1.1, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "rgba(255,255,255,.85)";
      context.fillRect(x - 1, y - 4, 2, 8);
      context.fillRect(x - 4, y - 1, 8, 2);
    }
  }
  context.restore();
  context.globalAlpha = 1;
  context.shadowBlur = 0;
}

function outputDimensions(ratio: AspectRatio, size: OutputSize): { width: number; height: number } {
  if (size === "720p") {
    if (ratio === "9:16") return { width: 720, height: 1280 };
    if (ratio === "1:1") return { width: 720, height: 720 };
    return { width: 1280, height: 720 };
  }
  if (ratio === "9:16") return { width: 1080, height: 1920 };
  if (ratio === "1:1") return { width: 1080, height: 1080 };
  return { width: 1920, height: 1080 };
}

function localRendererBase(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Enter a valid local renderer URL, such as http://127.0.0.1:8766.");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(host)
    || url.pathname !== "/" || url.username || url.password || url.search || url.hash) {
    throw new Error("For privacy, Motion Studio only connects to a renderer on this computer.");
  }
  return url.toString().replace(/\/$/, "");
}

export default function MotionStudio() {
  const [images, setImages] = useState<MotionImage[]>([]);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioError, setAudioError] = useState("");
  const [rendererUrl, setRendererUrl] = useState("http://127.0.0.1:8766");
  const [rendererReady, setRendererReady] = useState(false);
  const [rendererMessage, setRendererMessage] = useState("Local renderer not checked yet.");
  const [checkingRenderer, setCheckingRenderer] = useState(false);
  const [effect, setEffect] = useState<ImageEffectKind>("ken-burns");
  const [selectedImageId, setSelectedImageId] = useState("");
  const [draggedImageId, setDraggedImageId] = useState<string | null>(null);
  const [dropTargetImageId, setDropTargetImageId] = useState<string | null>(null);
  const [selectedKeyframeIndex, setSelectedKeyframeIndex] = useState(0);
  const [keyframePosition, setKeyframePosition] = useState(0.5);
  const [particlePreset, setParticlePreset] = useState<ParticlePreset>("none");
  const [particleIntensity, setParticleIntensity] = useState(55);
  const [parallaxStrength, setParallaxStrength] = useState(45);
  const [depthMapWorking, setDepthMapWorking] = useState(false);
  const [colabEndpoint, setColabEndpoint] = useState("");
  const [colabToken, setColabToken] = useState("");
  const [colabReady, setColabReady] = useState(false);
  const [colabChecking, setColabChecking] = useState(false);
  const [colabProgress, setColabProgress] = useState<ColabProgress | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewMuted, setPreviewMuted] = useState(false);
  const [previewPlaybackTime, setPreviewPlaybackTime] = useState(0);
  const [previewTransitionProgress, setPreviewTransitionProgress] = useState(0);
  const [previewIncomingVisible, setPreviewIncomingVisible] = useState(false);
  const [transition, setTransition] = useState<TransitionKind>("dissolve");
  const [transitionDuration, setTransitionDuration] = useState(0.6);
  const [zoomStrength, setZoomStrength] = useState(1.16);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
  const [outputSize, setOutputSize] = useState<OutputSize>("1080p");
  const [fps, setFps] = useState(30);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [previewSelectedImage, setPreviewSelectedImage] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [job, setJob] = useState<LocalRenderJob | null>(null);
  const [notice, setNotice] = useState("");
  const [soundtrackVolume, setSoundtrackVolume] = useState(1);
  const [audioFadeIn, setAudioFadeIn] = useState(0.5);
  const [audioFadeOut, setAudioFadeOut] = useState(1.5);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoPreviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoPreviewIncomingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoPreviewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewAnimationRef = useRef<number | null>(null);
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const objectUrlsRef = useRef<Set<string>>(new Set());
  const audioObjectUrlRef = useRef("");
  const renderControllerRef = useRef<AbortController | null>(null);
  const animationRef = useRef<number | null>(null);

  const dimensions = useMemo(() => outputDimensions(aspectRatio, outputSize), [aspectRatio, outputSize]);
  const secondsPerImage = images.length && audioDuration > 0 ? audioDuration / images.length : 0;
  const currentIndex = secondsPerImage > 0
    ? Math.min(images.length - 1, Math.floor(Math.min(playhead, Math.max(0, audioDuration - 0.001)) / secondsPerImage))
    : 0;
  const canRender = images.length > 0 && Boolean(audioFile) && audioDuration > 0
    && Number.isFinite(audioDuration) && audioDuration <= 24 * 60 * 60;
  const selectedImage = images.find((item) => item.asset.id === selectedImageId) ?? images[currentIndex];
  const editableKeyframes = selectedImage?.keyframes.length
    ? selectedImage.keyframes
    : selectedImage ? createPresetKeyframes(effect, zoomStrength) : [];
  const selectedKeyframe = editableKeyframes[Math.min(selectedKeyframeIndex, Math.max(0, editableKeyframes.length - 1))];
  const selectedParticles = selectedImage
    ? resolveParticleSettings(selectedImage.particlePreset, selectedImage.particleIntensity, particlePreset, particleIntensity)
    : { preset: particlePreset, intensity: particleIntensity };
  const selectedDepthFocus = selectedImage?.depthFocus ?? { x: 0.5, y: 0.45 };


  useEffect(() => {
    if (images.length && !images.some((item) => item.asset.id === selectedImageId)) {
      setSelectedImageId(images[0].asset.id);
      setSelectedKeyframeIndex(0);
    }
  }, [images, selectedImageId]);

  useEffect(() => {
    imageCacheRef.current.forEach((image) => { image.src = ""; });
    imageCacheRef.current.clear();
    drawAtTime(playhead);
  }, [images]);

  useEffect(() => {
    const draw = (time: number) => drawAtTime(time);
    const tick = () => {
      const audio = audioRef.current;
      if (audio && !audio.paused && !audio.ended) {
        draw(audio.currentTime);
        animationRef.current = requestAnimationFrame(tick);
      }
    };
    draw(playhead);
    if (playing) animationRef.current = requestAnimationFrame(tick);
    return () => {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    };
  }, [images, audioDuration, effect, zoomStrength, playhead, playing, aspectRatio, outputSize, particlePreset, particleIntensity, parallaxStrength, selectedImageId, previewSelectedImage]);

  function drawAtTime(
    time: number,
    targetCanvas: HTMLCanvasElement | null = canvasRef.current,
    forcedIndex?: number,
    forcedProgress?: number,
  ): void {
    const canvas = targetCanvas;
    if (!canvas) return;
    if (!images.length) {
      const context = canvas.getContext("2d");
      context?.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const safeTime = Math.max(0, Math.min(time, Math.max(0, audioDuration - 0.001)));
    const timelineIndex = secondsPerImage > 0
      ? Math.min(images.length - 1, Math.floor(safeTime / secondsPerImage))
      : 0;
    const selectedIndex = images.findIndex((item) => item.asset.id === selectedImageId);
    const useSelectedPreview = previewSelectedImage && selectedIndex >= 0;
    const index = typeof forcedIndex === "number" ? forcedIndex : useSelectedPreview ? selectedIndex : timelineIndex;
    const imageItem = images[index];
    if (!imageItem) return;
    const baseKey = "base:" + imageItem.asset.id;
    const depthKey = imageItem.foreground ? "depth:" + imageItem.foreground.asset.id : "";
    // Keep decoded frames cached: continuous transitions draw two source images
    // at once, and evicting the outgoing image each frame would cause reload flicker.
    let image = imageCacheRef.current.get(baseKey);
    if (!image) {
      image = new Image();
      image.onload = () => {
        const audio = videoPreviewAudioRef.current ?? audioRef.current;
        const currentTime = audio && Number.isFinite(audio.currentTime) ? audio.currentTime : safeTime;
        drawAtTime(currentTime);
        if (videoPreviewCanvasRef.current) drawAtTime(currentTime, videoPreviewCanvasRef.current, index, localProgress);
      };
      image.onerror = () => setNotice("Could not decode " + imageItem.asset.name + " for the preview.");
      imageCacheRef.current.set(baseKey, image);
      image.src = imageItem.objectUrl;
      return;
    }
    if (!image.complete || !image.naturalWidth) return;
    const localProgress = typeof forcedProgress === "number" ? forcedProgress : useSelectedPreview || !secondsPerImage
      ? 0.5
      : Math.max(0, Math.min(1, (safeTime - index * secondsPerImage) / secondsPerImage));
    const keyframes = imageItem.keyframes.length
      ? imageItem.keyframes
      : createPresetKeyframes(effect, zoomStrength);
    drawMotionFrame(canvas, image, effect, localProgress, zoomStrength, keyframes);

    if (imageItem.foreground) {
      let foreground = imageCacheRef.current.get(depthKey);
      if (!foreground) {
        foreground = new Image();
        foreground.onload = () => {
          const audio = videoPreviewAudioRef.current ?? audioRef.current;
          const currentTime = audio && Number.isFinite(audio.currentTime) ? audio.currentTime : safeTime;
          drawAtTime(currentTime);
          if (videoPreviewCanvasRef.current) drawAtTime(currentTime, videoPreviewCanvasRef.current, index, localProgress);
        };
        foreground.onerror = () => setNotice("Could not decode the transparent foreground layer for " + imageItem.asset.name + ".");
        imageCacheRef.current.set(depthKey, foreground);
        foreground.src = imageItem.foreground.objectUrl;
      } else if (foreground.complete && foreground.naturalWidth) {
        const context = canvas.getContext("2d");
        if (context) {
          const scale = Math.min(canvas.width / foreground.naturalWidth, canvas.height / foreground.naturalHeight);
          const drawWidth = foreground.naturalWidth * scale;
          const drawHeight = foreground.naturalHeight * scale;
          const strength = parallaxStrength / 100;
          const offsetX = Math.sin(localProgress * Math.PI * 2) * canvas.width * 0.035 * strength;
          const offsetY = Math.cos(localProgress * Math.PI * 2) * canvas.height * 0.02 * strength;
          context.save();
          context.drawImage(foreground, (canvas.width - drawWidth) / 2 + offsetX, (canvas.height - drawHeight) / 2 + offsetY, drawWidth, drawHeight);
          context.restore();
        }
      }
    }
    const particles = resolveParticleSettings(imageItem.particlePreset, imageItem.particleIntensity, particlePreset, particleIntensity);
    drawParticlePreview(canvas, particles.preset, localProgress, particles.intensity);
  }

  useEffect(() => {
    if (!previewOpen) {
      if (previewAnimationRef.current !== null) cancelAnimationFrame(previewAnimationRef.current);
      previewAnimationRef.current = null;
      videoPreviewAudioRef.current?.pause();
      return;
    }
    const audio = videoPreviewAudioRef.current;
    const schedule = buildMotionPreviewSchedule(
      images.map(() => secondsPerImage),
      transition,
      transitionDuration,
    );
    const draw = () => {
      const current = videoPreviewAudioRef.current;
      if (!current) return;
      const time = Math.min(current.currentTime, Math.max(0, audioDuration - 0.001));
      const state = getMotionPreviewFrameState(time, schedule);
      if (state?.kind === "transition") {
        drawAtTime(time, videoPreviewCanvasRef.current, state.outgoingIndex, state.outgoingProgress);
        drawAtTime(time, videoPreviewIncomingCanvasRef.current, state.incomingIndex, state.incomingProgress);
        setPreviewTransitionProgress(state.progress);
        setPreviewIncomingVisible(true);
      } else if (state?.kind === "clip") {
        drawAtTime(time, videoPreviewCanvasRef.current, state.currentIndex, state.progress);
        setPreviewIncomingVisible(false);
        setPreviewTransitionProgress(0);
      }
      setPreviewPlaybackTime(time);
      if (!current.paused && !current.ended) {
        previewAnimationRef.current = requestAnimationFrame(draw);
      }
    };
    draw();
    return () => {
      if (previewAnimationRef.current !== null) cancelAnimationFrame(previewAnimationRef.current);
      previewAnimationRef.current = null;
    };
  }, [previewOpen, images, audioDuration, secondsPerImage, transition, transitionDuration, effect, zoomStrength, aspectRatio, outputSize, particlePreset, particleIntensity, parallaxStrength]);

  useEffect(() => {
    if (!previewOpen) return;
    const audio = videoPreviewAudioRef.current;
    if (audio) {
      setPreviewSelectedImage(false);
      audio.pause();
      audio.currentTime = 0;
      setPreviewPlaybackTime(0);
    }
  }, [previewOpen, audioUrl, soundtrackVolume]);

  useEffect(() => () => {
    renderControllerRef.current?.abort();
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    if (audioObjectUrlRef.current) URL.revokeObjectURL(audioObjectUrlRef.current);
  }, []);

  const handleImageFiles = async (files: FileList | null) => {
    if (!files || rendering) return;
    const incoming = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (!incoming.length) {
      setNotice("Choose PNG, JPEG, WebP or another supported image file.");
      return;
    }
    const newImages: MotionImage[] = [];
    for (const file of incoming) {
      if (file.size <= 0 || file.size > 250 * 1024 * 1024) {
        setNotice("Skipped " + file.name + ": each image must be smaller than 250 MB.");
        continue;
      }
      const objectUrl = URL.createObjectURL(file);
      objectUrlsRef.current.add(objectUrl);
      try {
        const size = await imageDimensions(file, objectUrl);
        const id = crypto.randomUUID();
        const asset: ProjectImageAsset = {
          id,
          name: file.name,
          relativePath: "motion-studio/" + file.name,
          mimeType: file.type || "image/jpeg",
          bytes: file.size,
          sequenceNumber: null,
          order: images.length + newImages.length,
          width: size.width,
          height: size.height,
          fingerprint: file.name + ":" + file.size + ":" + file.lastModified,
        };
        newImages.push({ asset, file, objectUrl, keyframes: [], customKeyframes: false });
      } catch (error) {
        URL.revokeObjectURL(objectUrl);
        objectUrlsRef.current.delete(objectUrl);
        setNotice(error instanceof Error ? error.message : "An image could not be decoded.");
      }
    }
    setImages((current) => [...current, ...sortNaturally(newImages)].map((item, order) => ({ ...item, asset: { ...item.asset, order, sequenceNumber: order + 1 } })));
    if (newImages.length) {
      setSelectedImageId((current) => current || newImages[0].asset.id);
      setSelectedKeyframeIndex(0);
      setNotice("Imported " + newImages.length + " image(s). Originals remain unchanged.");
    }
  };

  const addForegroundLayer = async (imageId: string, file?: File) => {
    if (!file || rendering) return;
    if (!["image/png", "image/webp"].includes(file.type) || file.size <= 0 || file.size > 100 * 1024 * 1024) {
      setNotice("Use a transparent PNG or WebP foreground cutout under 100 MB.");
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    objectUrlsRef.current.add(objectUrl);
    try {
      const size = await imageDimensions(file, objectUrl);
      const id = crypto.randomUUID();
      const asset: ProjectImageAsset = {
        id,
        name: file.name,
        relativePath: "motion-studio/depth/" + file.name,
        mimeType: file.type,
        bytes: file.size,
        sequenceNumber: null,
        order: images.length,
        width: size.width,
        height: size.height,
        fingerprint: file.name + ":" + file.size + ":" + file.lastModified,
      };
      setImages((current) => current.map((item) => {
        if (item.asset.id !== imageId) return item;
        if (item.foreground) {
          URL.revokeObjectURL(item.foreground.objectUrl);
          objectUrlsRef.current.delete(item.foreground.objectUrl);
          const cached = imageCacheRef.current.get("depth:" + item.foreground.asset.id);
          if (cached) cached.src = "";
          imageCacheRef.current.delete("depth:" + item.foreground.asset.id);
        }
        return { ...item, foreground: { asset, file, objectUrl } };
      }));
      setNotice("Transparent foreground cutout added. It will move separately from its background during parallax rendering.");
    } catch (error) {
      URL.revokeObjectURL(objectUrl);
      objectUrlsRef.current.delete(objectUrl);
      setNotice(error instanceof Error ? error.message : "Could not load the foreground cutout.");
    }
  };

  const estimateDepthForImage = async (imageId: string) => {
    const source = images.find((item) => item.asset.id === imageId);
    if (!source || rendering || depthMapWorking) return;
    setDepthMapWorking(true);
    setNotice("Estimating a composition-based depth map locally in your browser…");
    try {
      const bitmap = await createImageBitmap(source.file);
      const scale = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(2, Math.round(bitmap.width * scale));
      const height = Math.max(2, Math.round(bitmap.height * scale));
      const sourceCanvas = document.createElement("canvas");
      sourceCanvas.width = width;
      sourceCanvas.height = height;
      const context = sourceCanvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("This browser could not create a local depth map canvas.");
      context.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
      const sourcePixels = context.getImageData(0, 0, width, height);
      const focus = source.depthFocus ?? { x: 0.5, y: 0.45 };
      const depth = createCompositionDepthMap(sourcePixels.data, width, height, focus, 0.82);
      context.putImageData(depthMapToImageData(depth, width, height), 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) => {
        sourceCanvas.toBlob((value) => value ? resolve(value) : reject(new Error("The browser could not encode the depth map.")), "image/png");
      });
      const file = new File([blob], "depth-" + source.asset.name.replace(/\.[^.]+$/, "") + ".png", { type: "image/png" });
      const objectUrl = URL.createObjectURL(file);
      objectUrlsRef.current.add(objectUrl);
      const assetId = crypto.randomUUID();
      const asset: ProjectImageAsset = {
        id: assetId,
        name: file.name,
        relativePath: "motion-studio/depth-maps/" + file.name,
        mimeType: "image/png",
        bytes: file.size,
        sequenceNumber: null,
        order: source.asset.order,
        width,
        height,
        fingerprint: file.name + ":" + file.size + ":" + file.lastModified,
      };
      setImages((current) => current.map((item) => {
        if (item.asset.id !== imageId) return item;
        if (item.depthMap) {
          URL.revokeObjectURL(item.depthMap.objectUrl);
          objectUrlsRef.current.delete(item.depthMap.objectUrl);
        }
        return { ...item, depthMap: { asset, file, objectUrl }, depthMotionAmount: item.depthMotionAmount ?? 35 };
      }));
      setNotice("Approximate depth map created locally. Adjust the focus point and rebuild it for a better composition.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not estimate image depth.");
    } finally {
      setDepthMapWorking(false);
    }
  };

  const removeDepthMap = (imageId: string) => {
    const target = images.find((item) => item.asset.id === imageId);
    if (target?.depthMap) {
      URL.revokeObjectURL(target.depthMap.objectUrl);
      objectUrlsRef.current.delete(target.depthMap.objectUrl);
    }
    setImages((current) => current.map((item) => item.asset.id === imageId
      ? { ...item, depthMap: undefined }
      : item));
  };

  const removeForegroundLayer = (imageId: string) => {
    const target = images.find((item) => item.asset.id === imageId);
    if (target?.foreground) {
      URL.revokeObjectURL(target.foreground.objectUrl);
      objectUrlsRef.current.delete(target.foreground.objectUrl);
      const cached = imageCacheRef.current.get("depth:" + target.foreground.asset.id);
      if (cached) cached.src = "";
      imageCacheRef.current.delete("depth:" + target.foreground.asset.id);
    }
    setImages((current) => current.map((item) => item.asset.id === imageId
      ? { ...item, foreground: undefined }
      : item));
  };

  const selectImageForEditing = (imageId: string) => {
    audioRef.current?.pause();
    setPreviewSelectedImage(true);
    setSelectedImageId(imageId);
    setSelectedKeyframeIndex(0);
  };

  const addKeyframe = () => {
    if (!selectedImage) return;
    const position = Math.max(0, Math.min(1, keyframePosition));
    const sampled = sampleMotionKeyframes(editableKeyframes, position);
    const next = insertMotionKeyframe(editableKeyframes, { ...sampled, time: position });
    setImages((current) => current.map((item) => item.asset.id === selectedImage.asset.id
      ? { ...item, keyframes: next, customKeyframes: true }
      : item));
    setSelectedKeyframeIndex(Math.max(0, next.findIndex((item) => Math.abs(item.time - position) < 0.0001)));
  };

  const updateSelectedKeyframe = (patch: Partial<MotionKeyframe>) => {
    if (!selectedImage || !selectedKeyframe) return;
    const updatedKeyframe = { ...selectedKeyframe, ...patch };
    if (patch.time !== undefined && editableKeyframes.some((item, index) =>
      index !== selectedKeyframeIndex && Math.abs(item.time - updatedKeyframe.time) < 0.005)) {
      setNotice("Keyframes need distinct positions. Move this key away from the neighbouring key.");
      return;
    }
    const next = editableKeyframes.map((item, index) => index === selectedKeyframeIndex
      ? updatedKeyframe
      : item).sort((a, b) => a.time - b.time);
    setSelectedKeyframeIndex(next.indexOf(updatedKeyframe));
    setImages((current) => current.map((item) => item.asset.id === selectedImage.asset.id
      ? { ...item, keyframes: next, customKeyframes: true }
      : item));
  };

  const removeSelectedKeyframe = () => {
    if (!selectedImage || editableKeyframes.length <= 2) return;
    const next = editableKeyframes.filter((_, index) => index !== selectedKeyframeIndex);
    setImages((current) => current.map((item) => item.asset.id === selectedImage.asset.id
      ? { ...item, keyframes: next, customKeyframes: true }
      : item));
    setSelectedKeyframeIndex(Math.max(0, Math.min(selectedKeyframeIndex, next.length - 1)));
  };

  const resetSelectedKeyframes = () => {
    if (!selectedImage) return;
    setImages((current) => current.map((item) => item.asset.id === selectedImage.asset.id
      ? { ...item, keyframes: [], customKeyframes: false }
      : item));
    setSelectedKeyframeIndex(0);
    setNotice("The selected image is using the current camera-motion preset again.");
  };

  const handleAudioFile = (file?: File) => {
    if (!file || rendering) return;
    if (!file.type.startsWith("audio/") && !/\.(wav|mp3|m4a|aac|ogg|opus|flac)$/i.test(file.name)) {
      setAudioError("Choose a supported audio file such as WAV, MP3, M4A or OGG.");
      return;
    }
    if (file.size <= 0 || file.size > 1024 * 1024 * 1024) {
      setAudioError("The soundtrack must be smaller than 1 GB.");
      return;
    }
    if (audioObjectUrlRef.current) {
      URL.revokeObjectURL(audioObjectUrlRef.current);
      audioObjectUrlRef.current = "";
    }
    const url = URL.createObjectURL(file);
    audioObjectUrlRef.current = url;
    setAudioFile(file);
    setAudioUrl(url);
    setAudioDuration(0);
    setPlayhead(0);
    setAudioError("");
    setNotice("Loading soundtrack metadata…");
  };

  const removeImage = (id: string) => {
    const target = images.find((item) => item.asset.id === id);
    if (target) {
      URL.revokeObjectURL(target.objectUrl);
      objectUrlsRef.current.delete(target.objectUrl);
      if (target.foreground) {
        URL.revokeObjectURL(target.foreground.objectUrl);
        objectUrlsRef.current.delete(target.foreground.objectUrl);
        const depthCached = imageCacheRef.current.get("depth:" + target.foreground.asset.id);
        if (depthCached) depthCached.src = "";
        imageCacheRef.current.delete("depth:" + target.foreground.asset.id);
      }
      if (target.depthMap) {
        URL.revokeObjectURL(target.depthMap.objectUrl);
        objectUrlsRef.current.delete(target.depthMap.objectUrl);
      }
      const cached = imageCacheRef.current.get("base:" + id) ?? imageCacheRef.current.get(id);
      if (cached) cached.src = "";
      imageCacheRef.current.delete("base:" + id);
      imageCacheRef.current.delete(id);
    }
    setImages((current) => current.filter((item) => item.asset.id !== id).map((item, order) => ({ ...item, asset: { ...item.asset, order, sequenceNumber: order + 1 } })));
  };

  const reorderImage = (fromId: string, toId: string) => {
    if (!fromId || !toId || fromId === toId) return;
    setImages((current) => {
      const from = current.findIndex((item) => item.asset.id === fromId);
      const to = current.findIndex((item) => item.asset.id === toId);
      if (from < 0 || to < 0) return current;
      const next = moveSequenceItem(current, from, to);
      return next.map((item, order) => ({
        ...item,
        asset: { ...item.asset, order, sequenceNumber: order + 1 },
      }));
    });
    setNotice("Image order updated. Every image still receives an equal share of the complete soundtrack.");
  };

  const moveImage = (index: number, delta: -1 | 1) => {
    setImages((current) => {
      const next = [...current];
      const target = index + delta;
      if (index < 0 || target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((item, order) => ({ ...item, asset: { ...item.asset, order, sequenceNumber: order + 1 } }));
    });
  };

  const checkRenderer = async () => {
    setCheckingRenderer(true);
    setRendererReady(false);
    setRendererMessage("Checking the renderer on this computer…");
    try {
      const base = localRendererBase(rendererUrl);
      const response = await fetch(base + "/v1/health", { cache: "no-store" });
      const data: unknown = await response.json();
      if (!response.ok || !data || typeof data !== "object" || !("ready" in data) || (data as { ready?: unknown }).ready !== true) {
        const message = data && typeof data === "object" && "message" in data
          ? String((data as { message: unknown }).message) : "FFmpeg or ffprobe is not ready.";
        throw new Error(message);
      }
      setRendererReady(true);
      setRendererMessage("Connected · FFmpeg and ffprobe are available on this computer.");
    } catch (error) {
      setRendererReady(false);
      setRendererMessage(error instanceof Error ? error.message : "Could not connect to the local renderer.");
    } finally {
      setCheckingRenderer(false);
    }
  };

  const buildRenderProject = async (): Promise<StudioProject> => {
    if (!audioFile || !canRender) throw new Error("Import images and a valid soundtrack before rendering.");
    const projectId = "motion-" + crypto.randomUUID();
    const sceneId = crypto.randomUUID();
    const trackId = crypto.randomUUID();
    const audioAssetId = crypto.randomUUID();
    const now = new Date().toISOString();
    const timelineClips: ProjectTimelineClip[] = buildEvenImageTimeline(
      images.map((item) => item.asset.id), audioDuration, sceneId,
    );
    const mixTrack: AudioMixTrack = {
      id: trackId,
      kind: "music",
      name: "Soundtrack",
      volume: soundtrackVolume,
      muted: false,
      solo: false,
      fadeInSeconds: audioFadeIn,
      fadeOutSeconds: audioFadeOut,
    };
    const mixAsset: MixAudioAsset = {
      id: audioAssetId,
      name: audioFile.name,
      mimeType: inferAudioMime(audioFile),
      bytes: audioFile.size,
      kind: "music",
      trackId,
      startSeconds: 0,
      durationSeconds: audioDuration,
      order: 0,
    };
    const imageAssetRecords = images.flatMap((item, order) => [
      { ...item.asset, order, sequenceNumber: order + 1 },
      ...(item.foreground ? [{ ...item.foreground.asset, order: images.length + order, sequenceNumber: null }] : []),
      ...(item.depthMap ? [{ ...item.depthMap.asset, order: images.length * 2 + order, sequenceNumber: null }] : []),
    ]);
    const transitionSeconds = transition === "cut" ? 0 : transitionDuration;
    const videoClipEdits: VideoClipEdit[] = timelineClips.map((clip, index) => ({
      clipId: clip.id,
      effect,
      transitionIn: index === 0 ? "cut" : transition,
      transitionOut: transition,
      transitionDurationSeconds: transitionSeconds,
      zoom: zoomStrength,
      keyframes: images[index].keyframes.length
        ? images[index].keyframes
        : createPresetKeyframes(effect, zoomStrength),
      particlePreset: resolveParticleSettings(images[index].particlePreset, images[index].particleIntensity, particlePreset, particleIntensity).preset,
      particleIntensity: resolveParticleSettings(images[index].particlePreset, images[index].particleIntensity, particlePreset, particleIntensity).intensity,
      ...(images[index].foreground
        ? { parallaxAssetId: images[index].foreground!.asset.id, parallaxAmount: parallaxStrength }
        : {}),
      ...(images[index].depthMap
        ? { depthMapAssetId: images[index].depthMap!.asset.id, depthMotionAmount: images[index].depthMotionAmount ?? 35 }
        : {}),
    }));
    const profileDimensions = outputDimensions(aspectRatio, outputSize);
    const renderProfile: RenderProfile = {
      ...profileDimensions,
      fps,
      aspectRatio,
      quality: "balanced",
      encoder: "software",
    };
    const project: StudioProject = {
      id: projectId,
      name: "GridSplit Motion Studio",
      source: "",
      scenes: [{
        id: sceneId,
        title: "Motion sequence",
        chapter: "Motion Studio",
        blocks: [],
        sourceText: "",
      }],
      createdAt: now,
      updatedAt: now,
      imageAssets: imageAssetRecords,
      imageMappings: [{ sceneId, imageIds: images.map((item) => item.asset.id) }],
      timelineClips,
      audioMixTracks: [mixTrack],
      mixAssets: [mixAsset],
      videoClipEdits,
      renderProfile,
    };
    const savedImageIds: string[] = [];
    try {
      for (const item of images) {
        await saveProjectImageBlob(item.asset.id, item.file);
        savedImageIds.push(item.asset.id);
        if (item.foreground) {
          await saveProjectImageBlob(item.foreground.asset.id, item.foreground.file);
          savedImageIds.push(item.foreground.asset.id);
        }
        if (item.depthMap) {
          await saveProjectImageBlob(item.depthMap.asset.id, item.depthMap.file);
          savedImageIds.push(item.depthMap.asset.id);
        }
      }
      await saveProjectMedia(projectId, audioAssetId, audioFile);
      return project;
    } catch (error) {
      await Promise.all([
        ...savedImageIds.map((id) => deleteProjectImageBlob(id).catch(() => undefined)),
        deleteProjectMedia(projectId, audioAssetId).catch(() => undefined),
      ]);
      throw error;
    }
  };

  const startRender = async () => {
    if (!canRender) {
      setNotice("Add at least one image and a soundtrack with readable duration.");
      return;
    }
    if (!rendererReady) {
      setNotice("Connect the local FFmpeg renderer before exporting.");
      return;
    }
    setRendering(true);
    setJob(null);
    setNotice("Preparing a temporary local render project…");
    const controller = new AbortController();
    renderControllerRef.current = controller;
    let temporaryProject: StudioProject | null = null;
    try {
      temporaryProject = await buildRenderProject();
      const result = await renderProjectLocally(temporaryProject, rendererUrl, (nextJob) => {
        setJob(nextJob);
        setNotice(nextJob.message || "Rendering locally…");
      }, controller.signal);
      downloadRenderedVideo(result.blob, "gridsplit-motion-studio");
      setJob(result.job);
      setNotice("MP4 rendered and validated locally. Your original images and soundtrack were not changed.");
    } catch (error) {
      const cancelled = controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
      setNotice(cancelled ? "Render cancelled. Temporary media will be cleaned up." : error instanceof Error ? error.message : "Motion Studio render failed.");
    } finally {
      if (temporaryProject) {
        await Promise.all([
          ...(temporaryProject.imageAssets ?? []).map((asset) => deleteProjectImageBlob(asset.id).catch(() => undefined)),
          ...(temporaryProject.mixAssets ?? []).map((asset) => deleteProjectMedia(temporaryProject!.id, asset.id).catch(() => undefined)),
        ]);
      }
      if (renderControllerRef.current === controller) renderControllerRef.current = null;
      setRendering(false);
    }
  };

  const downloadColabNotebook = () => {
    downloadMotionPackage(buildColabNotebook(), "GridSplit_Live_Colab_Renderer.ipynb");
    setNotice("Colab notebook downloaded. Open it in Google Colab, select a T4 GPU, and run all cells.");
  };

  const testColabConnection = async () => {
    setColabChecking(true);
    setColabReady(false);
    setColabProgress(null);
    try {
      const message = await checkColabRenderer(colabEndpoint, colabToken);
      setColabReady(true);
      setNotice(message);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not connect to the Colab renderer.");
    } finally {
      setColabChecking(false);
    }
  };

  const startColabRender = async () => {
    if (!canRender || rendering || !colabReady) return;
    setRendering(true);
    setJob(null);
    setColabProgress({ stage: "uploading", progress: 0, message: "Preparing the portable project archive…" });
    setNotice("Preparing the project for authenticated upload to Google Colab…");
    const controller = new AbortController();
    renderControllerRef.current = controller;
    let temporaryProject: StudioProject | null = null;
    try {
      temporaryProject = await buildRenderProject();
      const result = await renderProjectOnColab(
        temporaryProject, colabEndpoint, colabToken,
        (progress) => {
          setColabProgress(progress);
          if (progress.job) setJob(progress.job);
          setNotice(progress.message);
        },
        controller.signal,
      );
      downloadRenderedVideo(result.blob, "gridsplit-motion-studio-colab");
      setJob(result.job);
      setNotice("Colab FFmpeg render completed and the validated MP4 was downloaded.");
    } catch (error) {
      const cancelled = controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
      setNotice(cancelled ? "Colab render cancelled. Temporary upload/job data will be cleaned up." :
        error instanceof Error ? error.message : "Colab render failed.");
    } finally {
      if (temporaryProject) {
        await Promise.all([
          ...(temporaryProject.imageAssets ?? []).map((asset) => deleteProjectImageBlob(asset.id).catch(() => undefined)),
          ...(temporaryProject.mixAssets ?? []).map((asset) => deleteProjectMedia(temporaryProject!.id, asset.id).catch(() => undefined)),
        ]);
      }
      if (renderControllerRef.current === controller) renderControllerRef.current = null;
      setRendering(false);
    }
  };

  const cancelRender = () => renderControllerRef.current?.abort();

  const clearImages = () => {
    if (rendering) return;
    images.forEach((item) => {
      URL.revokeObjectURL(item.objectUrl);
      objectUrlsRef.current.delete(item.objectUrl);
      if (item.foreground) {
        URL.revokeObjectURL(item.foreground.objectUrl);
        objectUrlsRef.current.delete(item.foreground.objectUrl);
        const depthCached = imageCacheRef.current.get("depth:" + item.foreground.asset.id);
        if (depthCached) depthCached.src = "";
        imageCacheRef.current.delete("depth:" + item.foreground.asset.id);
      }
      if (item.depthMap) {
        URL.revokeObjectURL(item.depthMap.objectUrl);
        objectUrlsRef.current.delete(item.depthMap.objectUrl);
      }
      const cached = imageCacheRef.current.get("base:" + item.asset.id) ?? imageCacheRef.current.get(item.asset.id);
      if (cached) cached.src = "";
      imageCacheRef.current.delete("base:" + item.asset.id);
      imageCacheRef.current.delete(item.asset.id);
    });
    setImages([]);
  };

  const previewIndex = previewSelectedImage && selectedImage
    ? images.findIndex((item) => item.asset.id === selectedImage.asset.id)
    : currentIndex;
  const previewTime = previewSelectedImage && selectedImage
    ? "Editing image " + (previewIndex + 1) + " · midpoint preview"
    : audioDuration > 0 ? formatTime(playhead) + " / " + formatTime(audioDuration) : "Import a soundtrack to set the full duration";
  const previewImage = images[Math.max(0, previewIndex)];

  return (
    <section className="motion-studio">
      <header className="motion-studio-header">
        <div>
          <span className="motion-studio-eyebrow"><Sparkles size={13} /> NEW WORKSPACE · PROCEDURAL ANIMATION</span>
          <h1>Motion <em>Studio.</em></h1>
          <p>Turn a still-image sequence and soundtrack into a moving video. No AI model, paid API key or cloud upload is required.</p>
        </div>
        <div className="motion-studio-header-mark"><WandSparkles size={30} /><span>LOCAL FIRST</span></div>
      </header>

      <div className="motion-studio-principles">
        <span><ShieldCheck size={14} /> Media stays on this device</span>
        <span><Clapperboard size={14} /> H.264 + AAC MP4 output</span>
        <span><Sparkles size={14} /> Camera motion + transitions</span>
      </div>

      <div className="motion-studio-layout">
        <div className="motion-studio-main-column">
          <section className="motion-panel">
            <div className="motion-panel-heading">
              <div><span>01 · MEDIA</span><h2>Build your sequence</h2><p>Import numbered images and one complete soundtrack.</p></div>
              <label className="motion-add-images"><ImagePlus size={15} /> Add images
                <input type="file" accept="image/png,image/jpeg,image/webp,image/*" multiple disabled={rendering} onChange={(event) => { void handleImageFiles(event.currentTarget.files); event.currentTarget.value = ""; }} />
              </label>
            </div>
            <div className="motion-audio-import">
              <div className="motion-audio-icon"><FileAudio size={21} /></div>
              <div className="motion-audio-copy">
                <b>{audioFile ? audioFile.name : "Add your narration or soundtrack"}</b>
                <span>{audioDuration > 0 ? formatTime(audioDuration) + " · duration measured from the audio file" : "WAV, MP3, M4A, AAC, OGG or FLAC"}</span>
              </div>
              <label className="motion-audio-button"><Upload size={14} /> {audioFile ? "Replace audio" : "Choose audio"}
                <input type="file" accept="audio/*,.wav,.mp3,.m4a,.aac,.ogg,.opus,.flac" disabled={rendering} onChange={(event) => { handleAudioFile(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} />
              </label>
            </div>
            {audioUrl && <div className="motion-audio-player">
              <audio
                ref={audioRef}
                controls
                preload="metadata"
                src={audioUrl}
                onLoadedMetadata={(event) => {
                  const duration = event.currentTarget.duration;
                  if (!Number.isFinite(duration) || duration <= 0 || duration > 24 * 60 * 60) {
                    setAudioDuration(0);
                    setAudioError("The soundtrack has an invalid or unsupported duration.");
                    return;
                  }
                  setAudioDuration(duration);
                  setAudioError("");
                  setNotice("Soundtrack measured: " + formatTime(duration) + ". Image holds can now be distributed evenly.");
                }}
                onTimeUpdate={(event) => {
                  setPreviewSelectedImage(false);
                  setPlayhead(event.currentTarget.currentTime);
                }}
                onPlay={() => {
                  setPreviewSelectedImage(false);
                  setPlaying(true);
                }}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
                onError={() => setAudioError("The browser could not read this audio file. Try WAV or MP3.")} />
              {audioError && <small className="motion-error">{audioError}</small>}
            </div>}
            <div className="motion-sequence-summary">
              <div><b>{images.length}</b><span>images loaded</span></div>
              <div><b>{audioDuration > 0 && images.length ? formatTime(secondsPerImage) : "—"}</b><span>equal hold per image</span></div>
              <div><b>{audioDuration > 0 ? formatTime(audioDuration) : "—"}</b><span>complete video length</span></div>
            </div>
            {images.length > 0 && audioDuration > 0 && <div className="motion-visual-timeline">
              <div className="motion-visual-timeline-heading">
                <b>SEQUENCE TIMELINE</b>
                <span>Drag clips to reorder · equal duration per image</span>
              </div>
              <div className="motion-visual-timeline-track">
                {images.map((item, index) => <button
                  key={item.asset.id}
                  type="button"
                  draggable={!rendering}
                  title={"Drag to reorder image " + (index + 1)}
                  className={"motion-timeline-clip" + (index === currentIndex ? " active" : "") + (draggedImageId === item.asset.id ? " dragging" : "") + (dropTargetImageId === item.asset.id ? " drop-target" : "")}
                  onClick={() => selectImageForEditing(item.asset.id)}
                  onDragStart={(event) => {
                    setDraggedImageId(item.asset.id);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", item.asset.id);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    if (draggedImageId && draggedImageId !== item.asset.id) setDropTargetImageId(item.asset.id);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const fromId = draggedImageId || event.dataTransfer.getData("text/plain");
                    reorderImage(fromId, item.asset.id);
                    setDraggedImageId(null);
                    setDropTargetImageId(null);
                  }}
                  onDragEnd={() => {
                    setDraggedImageId(null);
                    setDropTargetImageId(null);
                  }}>
                  <span className="motion-timeline-index">{String(index + 1).padStart(2, "0")}</span>
                  <img src={item.objectUrl} alt="" />
                  <b>{item.asset.name}</b>
                  <small>{formatTime(secondsPerImage)}</small>
                </button>)}
              </div>
              <p>All clips are auto-fitted to the soundtrack. Reordering changes sequence, not the total video duration.</p>
            </div>}
            {images.length ? <div className="motion-image-list">
              <div className="motion-list-header"><b>IMAGE ORDER</b><button type="button" disabled={rendering} onClick={clearImages}><Trash2 size={13} /> Clear all</button></div>
              {images.map((item, index) => <article
                className={(index === currentIndex ? "motion-image-row active" : "motion-image-row") + (selectedImageId === item.asset.id ? " editing" : "")}
                key={item.asset.id}
                onClick={() => selectImageForEditing(item.asset.id)}>
                <span className="motion-image-number">{String(index + 1).padStart(2, "0")}</span>
                <img src={item.objectUrl} alt="" />
                <div className="motion-image-info">
                  <b title={item.asset.name}>{item.asset.name}</b>
                  <span>{item.asset.width} × {item.asset.height} · {(item.file.size / 1024 / 1024).toFixed(1)} MB</span>
                  <small className={(item.depthMap || item.foreground) ? "motion-depth-state ready" : "motion-depth-state"}>
                    {item.depthMap ? "Estimated depth map ready" : item.foreground ? "Transparent cutout attached" : "Flat image"}
                  </small>
                </div>
                <div className="motion-image-hold">{audioDuration > 0 ? formatTime(secondsPerImage) : "—"}</div>
                <div className="motion-image-actions">
                  <label className="motion-depth-upload" title="Attach a transparent foreground cutout">
                    <Layers3 size={12} />
                    <input type="file" accept="image/png,image/webp" disabled={rendering} onChange={(event) => { void addForegroundLayer(item.asset.id, event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} />
                  </label>
                  {item.foreground && <button type="button" title="Remove depth layer" aria-label="Remove depth layer" disabled={rendering} onClick={(event) => { event.stopPropagation(); removeForegroundLayer(item.asset.id); }}><Layers3 size={12} /></button>}
                  <button type="button" title="Move earlier" aria-label="Move image earlier" disabled={rendering || index === 0} onClick={(event) => { event.stopPropagation(); moveImage(index, -1); }}><ArrowUp size={13} /></button>
                  <button type="button" title="Move later" aria-label="Move image later" disabled={rendering || index === images.length - 1} onClick={(event) => { event.stopPropagation(); moveImage(index, 1); }}><ArrowDown size={13} /></button>
                  <button type="button" title="Remove image" aria-label="Remove image" disabled={rendering} onClick={(event) => { event.stopPropagation(); removeImage(item.asset.id); }}><Trash2 size={13} /></button>
                </div>
              </article>)}
            </div> : <label className="motion-dropzone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void handleImageFiles(event.dataTransfer.files); }}>
              <ImagePlus size={27} />
              <b>Choose or drop your storyboard images here</b>
              <span>Images are ordered naturally: 1, 2, 3 … 10, 11.</span>
              <input type="file" accept="image/png,image/jpeg,image/webp,image/*" multiple disabled={rendering} onChange={(event) => { void handleImageFiles(event.currentTarget.files); event.currentTarget.value = ""; }} />
            </label>}
            {images.length > 1 && audioDuration > 0 && <p className="motion-sync-note"><CheckCircle2 size={14} /> Automatic timing is exact: {images.length} images share the full {formatTime(audioDuration)} soundtrack evenly. The last image absorbs any floating-point remainder.</p>}
          </section>

          <section className="motion-panel">
            <div className="motion-panel-heading"><div><span>02 · ANIMATION</span><h2>Choose the motion language</h2><p>Every still gets a deterministic camera move, then transitions into the next frame.</p></div></div>
            <div className="motion-settings-grid">
              <label>Camera movement<select value={effect} disabled={rendering} onChange={(event) => setEffect(event.target.value as ImageEffectKind)}>{EFFECTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              <label>Scene transition<select value={transition} disabled={rendering} onChange={(event) => setTransition(event.target.value as TransitionKind)}>{TRANSITIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              <label>Transition length <span className="motion-setting-value">{transition === "cut" ? "0.00s" : transitionDuration.toFixed(2) + "s"}</span><input type="range" min="0.1" max="2" step="0.05" disabled={rendering || transition === "cut"} value={transitionDuration} onChange={(event) => setTransitionDuration(Number(event.target.value))} /></label>
              <label>Motion intensity <span className="motion-setting-value">{zoomStrength.toFixed(2)}×</span><input type="range" min="1.02" max="1.5" step="0.01" disabled={rendering} value={zoomStrength} onChange={(event) => setZoomStrength(Number(event.target.value))} /></label>
            </div>
            <div className="motion-preview">
              <div className="motion-preview-screen" style={{ aspectRatio: dimensions.width + " / " + dimensions.height }}>
                <canvas ref={canvasRef} width={dimensions.width > dimensions.height ? 1280 : dimensions.width === dimensions.height ? 900 : 720} height={dimensions.height > dimensions.width ? 1280 : dimensions.width === dimensions.height ? 900 : 720} />
                {!images.length && <div className="motion-preview-empty"><Clapperboard size={25} /><b>Your animated preview appears here</b><span>Import images and audio to preview the sequence.</span></div>}
              </div>
              <div className="motion-preview-footer"><span>{previewImage ? "FRAME " + (currentIndex + 1) + " / " + images.length + " · " + previewImage.asset.name : "NO FRAME SELECTED"}</span><span>{previewTime}</span></div>
              <button type="button" className="motion-secondary-button motion-open-preview" disabled={!canRender} onClick={() => setPreviewOpen(true)}><Maximize2 size={14} /> Open Video Preview</button>
            </div>
          </section>

          <section className="motion-panel motion-keyframe-panel">
            <div className="motion-panel-heading">
              <div><span>03 · KEYFRAME ANIMATION</span><h2>Animate transform layers</h2><p>Author position, scale and rotation across each image hold.</p></div>
              <KeyRound size={20} />
            </div>
            <label className="motion-field">Image being edited
              <select value={selectedImage?.asset.id ?? ""} disabled={!images.length || rendering} onChange={(event) => selectImageForEditing(event.target.value)}>
                {images.map((item, index) => <option key={item.asset.id} value={item.asset.id}>{index + 1}. {item.asset.name}</option>)}
              </select>
            </label>
            {selectedImage && <>
              <div className="motion-keyframe-strip">
                {editableKeyframes.map((keyframe, index) => <button
                  key={keyframe.time}
                  type="button"
                  className={index === selectedKeyframeIndex ? "active" : ""}
                  disabled={rendering}
                  onClick={() => { setSelectedKeyframeIndex(index); setKeyframePosition(keyframe.time); }}>
                  <KeyRound size={11} /> {Math.round(keyframe.time * 100)}%
                </button>)}
                <span>{editableKeyframes.length} keys</span>
              </div>
              <label className="motion-range-field">New keyframe position <b>{Math.round(keyframePosition * 100)}%</b>
                <input type="range" min="0" max="1" step="0.01" value={keyframePosition} disabled={rendering} onChange={(event) => setKeyframePosition(Number(event.target.value))} />
              </label>
              <div className="motion-keyframe-actions">
                <button type="button" className="motion-secondary-button" disabled={rendering || editableKeyframes.length >= 32} onClick={addKeyframe}><KeyRound size={13} /> Add / replace keyframe</button>
                <button type="button" className="motion-secondary-button" disabled={rendering || editableKeyframes.length <= 2} onClick={removeSelectedKeyframe}><Trash2 size={13} /> Remove selected</button>
                <button type="button" className="motion-secondary-button" disabled={rendering || !selectedImage.customKeyframes} onClick={resetSelectedKeyframes}><RefreshCw size={13} /> Reset to preset</button>
              </div>
              {selectedKeyframe && <div className="motion-keyframe-controls">
                <label className="motion-range-field">Keyframe time <b>{Math.round(selectedKeyframe.time * 100)}%</b>
                  <input type="range" min="0" max="1" step="0.01" value={selectedKeyframe.time} disabled={rendering} onChange={(event) => { const time = Number(event.target.value); setKeyframePosition(time); updateSelectedKeyframe({ time }); }} />
                </label>
                <label className="motion-range-field">Scale <b>{selectedKeyframe.scale.toFixed(2)}×</b>
                  <input type="range" min="1" max="1.5" step="0.01" value={selectedKeyframe.scale} disabled={rendering} onChange={(event) => updateSelectedKeyframe({ scale: Number(event.target.value) })} />
                </label>
                <label className="motion-range-field">Horizontal position <b>{Math.round(selectedKeyframe.panX * 100)}%</b>
                  <input type="range" min="0" max="1" step="0.01" value={selectedKeyframe.panX} disabled={rendering} onChange={(event) => updateSelectedKeyframe({ panX: Number(event.target.value) })} />
                </label>
                <label className="motion-range-field">Vertical position <b>{Math.round(selectedKeyframe.panY * 100)}%</b>
                  <input type="range" min="0" max="1" step="0.01" value={selectedKeyframe.panY} disabled={rendering} onChange={(event) => updateSelectedKeyframe({ panY: Number(event.target.value) })} />
                </label>
                <label className="motion-range-field">Rotation <b>{selectedKeyframe.rotation.toFixed(1)}°</b>
                  <input type="range" min="-25" max="25" step="0.5" value={selectedKeyframe.rotation} disabled={rendering} onChange={(event) => updateSelectedKeyframe({ rotation: Number(event.target.value) })} />
                </label>
              </div>}
              <p className="motion-note">The preview interpolates between keyframes. Add your own key to override the preset for this image.</p>
            </>}
          </section>

          <section className="motion-panel motion-particle-panel">
            <div className="motion-panel-heading">
              <div><span>04 · PARTICLE EFFECTS</span><h2>Layer procedural particles</h2><p>Effekseer-inspired overlays rendered locally as a separate pass.</p></div>
              <Flame size={20} />
            </div>
            <div className="motion-particle-defaults">
              <b>GLOBAL DEFAULTS</b>
              <label className="motion-field">Default particle preset
                <select value={particlePreset} disabled={rendering} onChange={(event) => setParticlePreset(event.target.value as ParticlePreset)}>
                  <option value="none">No particles</option>
                  <option value="embers">Fire embers</option>
                  <option value="snow">Snowfall</option>
                  <option value="rain">Rain streaks</option>
                  <option value="confetti">Confetti</option>
                  <option value="magic">Magic sparks</option>
                </select>
              </label>
              <label className="motion-range-field">Default density <b>{particleIntensity}%</b>
                <input type="range" min="0" max="100" step="5" value={particleIntensity} disabled={rendering || particlePreset === "none"} onChange={(event) => setParticleIntensity(Number(event.target.value))} />
              </label>
            </div>
            <div className="motion-particle-override">
              <b>SELECTED IMAGE · {selectedImage ? selectedImage.asset.name : "NONE"}</b>
              {selectedImage ? <>
                <label className="motion-field">This image's particle effect
                  <select value={selectedImage.particlePreset ?? "inherit"} disabled={rendering} onChange={(event) => {
                    const value = event.target.value;
                    setImages((current) => current.map((item) => item.asset.id === selectedImage.asset.id
                      ? { ...item, particlePreset: value === "inherit" ? undefined : value as ParticlePreset }
                      : item));
                  }}>
                    <option value="inherit">Use global default ({particlePreset})</option>
                    <option value="none">No particles</option>
                    <option value="embers">Fire embers</option>
                    <option value="snow">Snowfall</option>
                    <option value="rain">Rain streaks</option>
                    <option value="confetti">Confetti</option>
                    <option value="magic">Magic sparks</option>
                  </select>
                </label>
                <label className="motion-range-field">Image density <b>{selectedParticles.intensity}%</b>
                  <input type="range" min="0" max="100" step="5" value={selectedParticles.intensity} disabled={rendering || selectedParticles.preset === "none"} onChange={(event) => {
                    const value = Number(event.target.value);
                    setImages((current) => current.map((item) => item.asset.id === selectedImage.asset.id
                      ? { ...item, particleIntensity: value }
                      : item));
                  }} />
                </label>
                <button type="button" className="motion-secondary-button" disabled={rendering || (selectedImage.particlePreset === undefined && selectedImage.particleIntensity === undefined)} onClick={() => setImages((current) => current.map((item) => item.asset.id === selectedImage.asset.id
                  ? { ...item, particlePreset: undefined, particleIntensity: undefined }
                  : item))}>Reset image to global defaults</button>
              </> : <p className="motion-note">Select an image in the sequence to customize its effect.</p>}
            </div>
            <div className="motion-effect-legend">
              <span><Flame size={13} /> Fire embers</span>
              <span><CloudSnow size={13} /> Snow</span>
              <span><CloudRain size={13} /> Rain</span>
              <span><SparklesIcon size={13} /> Magic</span>
            </div>
            <p className="motion-note">Procedural overlays only; they do not generate realistic smoke or fire footage. The chosen effect is applied to all image clips.</p>
          </section>

          <section className="motion-panel motion-parallax-panel">
            <div className="motion-panel-heading">
              <div><span>05 · DEPTH & PARALLAX</span><h2>Create image depth</h2><p>Estimate a depth map locally or attach a transparent foreground cutout.</p></div>
              <Layers3 size={20} />
            </div>
            {selectedImage ? <>
              <div className="motion-depth-estimator">
                <b>LOCAL DEPTH ESTIMATOR</b>
                <p>Builds a lightweight grayscale depth field from the image's composition, focus point and visual contrast. It runs in your browser with no API, model download or upload.</p>
                <div className="motion-depth-focus-grid">
                  <label>Focus X <b>{Math.round(selectedDepthFocus.x * 100)}%</b>
                    <input type="range" min="0" max="100" step="1" value={Math.round(selectedDepthFocus.x * 100)} disabled={rendering || depthMapWorking} onChange={(event) => {
                      const x = Number(event.target.value) / 100;
                      setImages((current) => current.map((item) => item.asset.id === selectedImage.asset.id ? { ...item, depthFocus: { ...(item.depthFocus ?? { x: 0.5, y: 0.45 }), x } } : item));
                    }} />
                  </label>
                  <label>Focus Y <b>{Math.round(selectedDepthFocus.y * 100)}%</b>
                    <input type="range" min="0" max="100" step="1" value={Math.round(selectedDepthFocus.y * 100)} disabled={rendering || depthMapWorking} onChange={(event) => {
                      const y = Number(event.target.value) / 100;
                      setImages((current) => current.map((item) => item.asset.id === selectedImage.asset.id ? { ...item, depthFocus: { ...(item.depthFocus ?? { x: 0.5, y: 0.45 }), y } } : item));
                    }} />
                  </label>
                </div>
                <button type="button" className="motion-secondary-button" disabled={rendering || depthMapWorking} onClick={() => void estimateDepthForImage(selectedImage.asset.id)}>
                  {depthMapWorking ? <Loader2 size={13} /> : <WandSparkles size={13} />}
                  {depthMapWorking ? "Estimating…" : selectedImage.depthMap ? "Rebuild depth map" : "Estimate depth locally"}
                </button>
                {selectedImage.depthMap && <div className="motion-depth-map-preview">
                  <img src={selectedImage.depthMap.objectUrl} alt="Estimated grayscale depth map" />
                  <div><b>Depth map ready</b><span>Brighter regions are treated as nearer. Rebuild after changing the focus point.</span></div>
                  <button type="button" className="motion-secondary-button" disabled={rendering} onClick={() => removeDepthMap(selectedImage.asset.id)}>Remove map</button>
                </div>}
                {selectedImage.depthMap && <label className="motion-range-field">3D displacement strength <b>{selectedImage.depthMotionAmount ?? 35}%</b>
                  <input type="range" min="0" max="100" step="5" value={selectedImage.depthMotionAmount ?? 35} disabled={rendering} onChange={(event) => {
                    const value = Number(event.target.value);
                    setImages((current) => current.map((item) => item.asset.id === selectedImage.asset.id ? { ...item, depthMotionAmount: value } : item));
                  }} />
                </label>}
              </div>
              <div className="motion-parallax-divider" />
            </> : <p className="motion-note">Select an image above to estimate its depth map.</p>}
            <label className="motion-range-field">Manual cutout parallax strength <b>{parallaxStrength}%</b>
              <input type="range" min="0" max="100" step="5" value={parallaxStrength} disabled={rendering} onChange={(event) => setParallaxStrength(Number(event.target.value))} />
            </label>
            <div className="motion-depth-summary">
              <b>{images.filter((item) => item.depthMap).length} estimated maps · {images.filter((item) => item.foreground).length} transparent cutouts</b>
              <span>Depth-map displacement is a subtle warp of the original image. Transparent cutouts remain available for more noticeable independent foreground motion.</span>
            </div>
            <p className="motion-note">This is a composition-based approximation, not a neural monocular-depth model or accurate 3D reconstruction. The final warp is rendered locally by FFmpeg.</p>
          </section>
        </div>

        <aside className="motion-studio-side-column">
          <section className="motion-panel motion-render-panel">
            <div className="motion-panel-heading"><div><span>06 · EXPORT</span><h2>Render your video</h2><p>Final rendering uses the local FFmpeg engine.</p></div></div>
            <label className="motion-field">Aspect ratio<select value={aspectRatio} disabled={rendering} onChange={(event) => setAspectRatio(event.target.value as AspectRatio)}><option value="16:9">16:9 · YouTube</option><option value="9:16">9:16 · Shorts / Reels</option><option value="1:1">1:1 · Square</option></select></label>
            <label className="motion-field">Resolution<select value={outputSize} disabled={rendering} onChange={(event) => setOutputSize(event.target.value as OutputSize)}><option value="1080p">1080p · Full HD</option><option value="720p">720p · HD</option></select></label>
            <label className="motion-field">Frame rate<select value={fps} disabled={rendering} onChange={(event) => setFps(Number(event.target.value))}><option value={24}>24 FPS · cinematic</option><option value={30}>30 FPS · standard</option><option value={60}>60 FPS · smooth</option></select></label>
            <div className="motion-audio-mix">
              <b><AudioLines size={14} /> SOUNDTRACK MIX</b>
              <label>Volume <span>{Math.round(soundtrackVolume * 100)}%</span><input type="range" min="0" max="1.5" step="0.05" disabled={rendering} value={soundtrackVolume} onChange={(event) => setSoundtrackVolume(Number(event.target.value))} /></label>
              <label>Fade in <span>{audioFadeIn.toFixed(1)}s</span><input type="range" min="0" max="5" step="0.1" disabled={rendering} value={audioFadeIn} onChange={(event) => setAudioFadeIn(Number(event.target.value))} /></label>
              <label>Fade out <span>{audioFadeOut.toFixed(1)}s</span><input type="range" min="0" max="10" step="0.1" disabled={rendering} value={audioFadeOut} onChange={(event) => setAudioFadeOut(Number(event.target.value))} /></label>
            </div>
            <div className="motion-colab-connection">
              <div className="motion-panel-heading"><div><span>GOOGLE COLAB · GPU RENDERING</span><h2>Render on Google Colab</h2><p>Use your running Colab T4 session with the same portable project archive and FFmpeg pipeline.</p></div><Cloud size={19} /></div>
              <button type="button" className="motion-secondary-button" onClick={downloadColabNotebook} disabled={rendering}><Cloud size={13} /> Download Colab notebook (.ipynb)</button>
              <label className="motion-field">Colab Quick Tunnel URL
                <input value={colabEndpoint} disabled={rendering} placeholder="https://your-tunnel.trycloudflare.com" onChange={(event) => { setColabEndpoint(event.target.value); setColabReady(false); }} />
              </label>
              <label className="motion-field">Secure connection token
                <input type="password" autoComplete="off" value={colabToken} disabled={rendering} placeholder="Paste token from the running Colab notebook" onChange={(event) => { setColabToken(event.target.value); setColabReady(false); }} />
              </label>
              <button type="button" className="motion-secondary-button" onClick={() => void testColabConnection()} disabled={colabChecking || rendering || !colabEndpoint.trim() || !colabToken.trim()}>
                {colabChecking ? <Loader2 size={13} /> : <RefreshCw size={13} />} {colabChecking ? "Testing connection…" : "Test Connection"}
              </button>
              <p className={colabReady ? "motion-renderer-status ready" : "motion-renderer-status"}>{colabReady ? <CheckCircle2 size={13} /> : <span className="motion-status-dot" />}{colabReady ? "Connected to authenticated Colab renderer." : "Not connected. Run the notebook in Colab and paste its URL and token."}</p>
              <p className="motion-colab-caption">The renderer binds to loopback in Colab and is reachable only through the authenticated Quick Tunnel. The token is sent in request headers, not URL parameters.</p>
            </div>
                        <div className="motion-renderer-connection">
              <b><ShieldCheck size={14} /> LOCAL RENDERER</b>
              <input aria-label="Local renderer URL" value={rendererUrl} disabled={rendering} onChange={(event) => { setRendererUrl(event.target.value); setRendererReady(false); }} />
              <button type="button" className="motion-secondary-button" onClick={() => void checkRenderer()} disabled={checkingRenderer || rendering}><RefreshCw size={13} /> {checkingRenderer ? "Checking…" : "Check connection"}</button>
              <p className={rendererReady ? "motion-renderer-status ready" : "motion-renderer-status"}>{rendererReady ? <CheckCircle2 size={13} /> : <span className="motion-status-dot" />}{rendererMessage}</p>
              {!rendererReady && <div className="motion-install-note"><b>Start the local engine</b><code>python local-render/server.py --allow-origin http://localhost:5173</code><small>For the deployed site, allow its exact HTTPS origin instead. Keep the sidecar running while rendering.</small></div>}
            </div>
            <button type="button" className="motion-colab-button" disabled={!canRender || !colabReady || rendering} onClick={() => void startColabRender()}>
              {rendering && colabProgress ? <Loader2 size={14} /> : <Cloud size={14} />}
              Render on Google Colab
            </button>
            {rendering ? <div className="motion-job-status">
              <div><Loader2 size={15} /><b>{colabProgress ? colabProgress.stage === "uploading" ? "Uploading to Colab" : colabProgress.stage === "downloading" ? "Downloading MP4" : job?.status === "queued" ? "Queued on Colab" : "Rendering on Colab" : job?.status === "running" ? "Rendering locally" : "Preparing render"}</b><span>{Math.round(colabProgress?.progress ?? job?.progress ?? 0)}%</span></div>
              <div className="motion-progress"><span style={{ width: (colabProgress?.progress ?? job?.progress ?? 0) + "%" }} /></div>
              <p>{colabProgress?.message || job?.message || "Preparing source files…"}</p>
              <button type="button" className="motion-cancel-button" onClick={cancelRender}><Square size={13} /> Cancel render</button>
            </div> : <button type="button" className="motion-render-button" disabled={!canRender || !rendererReady} onClick={() => void startRender()}><Clapperboard size={16} /> Render MP4 locally</button>}
            {notice && <p className="motion-notice" role="status">{notice}</p>}
          </section>
          <section className="motion-panel motion-limits-panel">
            <b><Sparkles size={14} /> WHAT THIS MODE DOES</b>
            <p>Creates movement with camera animation, zoom, pan and transitions. It does not use an AI image-to-video model or invent new subject motion.</p>
            <p>Custom keyframes, procedural particles and manually supplied transparent foreground cutouts are included as separate animation layers. Subject cutouts are not inferred automatically.</p>
          </section>
        </aside>
      </div>
      {previewOpen && <div className="motion-video-modal" role="dialog" aria-modal="true" aria-label="Fullscreen video preview" tabIndex={-1} onKeyDown={(event) => { if (event.key === "Escape") setPreviewOpen(false); }}>
        <div className="motion-video-modal-content">
          <div className="motion-video-stage" style={{ aspectRatio: dimensions.width + " / " + dimensions.height }}>
            <canvas
              ref={videoPreviewCanvasRef}
              width={dimensions.width > dimensions.height ? 1280 : dimensions.width === dimensions.height ? 900 : 720}
              height={dimensions.height > dimensions.width ? 1280 : dimensions.width === dimensions.height ? 900 : 720}
              className="motion-video-preview-layer"
            />
            <canvas
              ref={videoPreviewIncomingCanvasRef}
              width={dimensions.width > dimensions.height ? 1280 : dimensions.width === dimensions.height ? 900 : 720}
              height={dimensions.height > dimensions.width ? 1280 : dimensions.width === dimensions.height ? 900 : 720}
              className="motion-video-preview-layer motion-video-preview-incoming"
              style={{ opacity: previewIncomingVisible ? previewTransitionProgress : 0 }}
            />
          </div>
          <audio
            ref={videoPreviewAudioRef}
            src={audioUrl || undefined}
            preload="auto"
            muted={previewMuted}
            onTimeUpdate={(event) => {
              const audio = event.currentTarget;
              const elapsed = audio.currentTime;
              const fadeIn = audioFadeIn > 0 ? Math.min(1, elapsed / audioFadeIn) : 1;
              const remaining = audioDuration - elapsed;
              const fadeOut = audioFadeOut > 0 ? Math.min(1, Math.max(0, remaining / audioFadeOut)) : 1;
              audio.volume = Math.min(1, Math.max(0, soundtrackVolume * Math.min(fadeIn, fadeOut)));
              setPreviewPlaybackTime(elapsed);
            }}
            onPlay={() => {
              if (previewAnimationRef.current !== null) cancelAnimationFrame(previewAnimationRef.current);
              const tick = () => {
                const audio = videoPreviewAudioRef.current;
                if (!audio || audio.paused || audio.ended) return;
                const time = audio.currentTime;
                const state = getMotionPreviewFrameState(time, buildMotionPreviewSchedule(images.map(() => secondsPerImage), transition, transitionDuration));
                if (state?.kind === "transition") {
                  drawAtTime(time, videoPreviewCanvasRef.current, state.outgoingIndex, state.outgoingProgress);
                  drawAtTime(time, videoPreviewIncomingCanvasRef.current, state.incomingIndex, state.incomingProgress);
                  setPreviewTransitionProgress(state.progress);
                  setPreviewIncomingVisible(true);
                } else if (state?.kind === "clip") {
                  drawAtTime(time, videoPreviewCanvasRef.current, state.currentIndex, state.progress);
                  setPreviewIncomingVisible(false);
                }
                setPreviewPlaybackTime(time);
                previewAnimationRef.current = requestAnimationFrame(tick);
              };
              previewAnimationRef.current = requestAnimationFrame(tick);
            }}
            onPause={() => {
              if (previewAnimationRef.current !== null) cancelAnimationFrame(previewAnimationRef.current);
              previewAnimationRef.current = null;
              if (videoPreviewAudioRef.current) {
                const time = videoPreviewAudioRef.current.currentTime;
                const state = getMotionPreviewFrameState(time, buildMotionPreviewSchedule(images.map(() => secondsPerImage), transition, transitionDuration));
                if (state?.kind === "clip") {
                  drawAtTime(time, videoPreviewCanvasRef.current, state.currentIndex, state.progress);
                  setPreviewIncomingVisible(false);
                } else if (state?.kind === "transition") {
                  drawAtTime(time, videoPreviewCanvasRef.current, state.outgoingIndex, state.outgoingProgress);
                  drawAtTime(time, videoPreviewIncomingCanvasRef.current, state.incomingIndex, state.incomingProgress);
                  setPreviewTransitionProgress(state.progress);
                  setPreviewIncomingVisible(true);
                }
              }
            }}
            onEnded={() => setPreviewPlaybackTime(audioDuration)}
            onTimeUpdate={(event) => setPreviewPlaybackTime(event.currentTarget.currentTime)}
          />
          <div className="motion-video-controls">
            <div className="motion-video-time"><span>{formatTime(previewPlaybackTime)}</span><span>{formatTime(audioDuration)}</span></div>
            <input
              aria-label="Seek video preview"
              type="range"
              min="0"
              max={Math.max(0, audioDuration)}
              step="0.01"
              value={Math.min(previewPlaybackTime, audioDuration)}
              onChange={(event) => {
                const audio = videoPreviewAudioRef.current;
                if (audio) {
                  audio.currentTime = Number(event.target.value);
                  setPreviewPlaybackTime(audio.currentTime);
                  const state = getMotionPreviewFrameState(audio.currentTime, buildMotionPreviewSchedule(images.map(() => secondsPerImage), transition, transitionDuration));
                  if (state?.kind === "clip") {
                    drawAtTime(audio.currentTime, videoPreviewCanvasRef.current, state.currentIndex, state.progress);
                    setPreviewIncomingVisible(false);
                  } else if (state?.kind === "transition") {
                    drawAtTime(audio.currentTime, videoPreviewCanvasRef.current, state.outgoingIndex, state.outgoingProgress);
                    drawAtTime(audio.currentTime, videoPreviewIncomingCanvasRef.current, state.incomingIndex, state.incomingProgress);
                    setPreviewTransitionProgress(state.progress);
                    setPreviewIncomingVisible(true);
                  }
                }
              }}
            />
            <div className="motion-video-control-buttons">
              <button type="button" aria-label={videoPreviewAudioRef.current?.paused ? "Play" : "Pause"} onClick={() => {
                const audio = videoPreviewAudioRef.current;
                if (!audio) return;
                if (audio.paused) void audio.play();
                else audio.pause();
              }}>{videoPreviewAudioRef.current?.paused ? <Play size={18} /> : <Pause size={18} />}</button>
              <button type="button" aria-label="Restart preview" onClick={() => {
                const audio = videoPreviewAudioRef.current;
                if (audio) { audio.currentTime = 0; setPreviewPlaybackTime(0); void audio.play(); }
              }}><RefreshCw size={17} /></button>
              <button type="button" aria-label={previewMuted ? "Unmute" : "Mute"} onClick={() => setPreviewMuted((value) => !value)}>{previewMuted ? <VolumeX size={17} /> : <Volume2 size={17} />}</button>
              <button type="button" aria-label="Close video preview" onClick={() => setPreviewOpen(false)}><X size={19} /></button>
            </div>
          </div>
        </div>
      </div>}
    </section>
  );
}
