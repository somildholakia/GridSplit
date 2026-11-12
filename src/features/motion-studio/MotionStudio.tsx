import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown, ArrowUp, AudioLines, CheckCircle2, Clapperboard, FileAudio,
  ImagePlus, Loader2, RefreshCw, ShieldCheck, Sparkles, Square,
  Trash2, Upload, WandSparkles, KeyRound, Layers3, Flame, CloudSnow, CloudRain, Sparkles as SparklesIcon,
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
import { buildEvenImageTimeline } from "./motionTiming";
import { createPresetKeyframes, insertMotionKeyframe, sampleMotionKeyframes } from "./motionLayers";
import { buildColabRenderPackage, downloadMotionPackage } from "./colabExport";
import "./motion-studio.css";

type MotionForeground = { asset: ProjectImageAsset; file: File; objectUrl: string };
type MotionImage = {
  asset: ProjectImageAsset;
  file: File;
  objectUrl: string;
  foreground?: MotionForeground;
  keyframes: MotionKeyframe[];
  customKeyframes: boolean;
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
  const offsetY = 0;
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
  const [transition, setTransition] = useState<TransitionKind>("dissolve");
  const [transitionDuration, setTransitionDuration] = useState(0.6);
  const [zoomStrength, setZoomStrength] = useState(1.16);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
  const [outputSize, setOutputSize] = useState<OutputSize>("1080p");
  const [fps, setFps] = useState(30);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [job, setJob] = useState<LocalRenderJob | null>(null);
  const [notice, setNotice] = useState("");
  const [soundtrackVolume, setSoundtrackVolume] = useState(1);
  const [audioFadeIn, setAudioFadeIn] = useState(0.5);
  const [audioFadeOut, setAudioFadeOut] = useState(1.5);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
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
  }, [images, audioDuration, effect, zoomStrength, playhead, playing, aspectRatio, outputSize]);

  function drawAtTime(time: number): void {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!images.length || !secondsPerImage) {
      const context = canvas.getContext("2d");
      context?.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const safeTime = Math.max(0, Math.min(time, Math.max(0, audioDuration - 0.001)));
    const index = Math.min(images.length - 1, Math.floor(safeTime / secondsPerImage));
    const imageItem = images[index];
    if (!imageItem) return;
    let image = imageCacheRef.current.get(imageItem.asset.id);
    if (!image) {
      imageCacheRef.current.forEach((cached) => { cached.src = ""; });
      imageCacheRef.current.clear();
      image = new Image();
      image.onload = () => {
        const audio = audioRef.current;
        drawAtTime(audio && Number.isFinite(audio.currentTime) ? audio.currentTime : safeTime);
      };
      image.onerror = () => setNotice("Could not decode " + imageItem.asset.name + " for the preview.");
      imageCacheRef.current.set(imageItem.asset.id, image);
      image.src = imageItem.objectUrl;
      return;
    }
    if (!image.complete || !image.naturalWidth) return;
    const localProgress = Math.max(0, Math.min(1, (safeTime - index * secondsPerImage) / secondsPerImage));
    drawMotionFrame(canvas, image, effect, localProgress, zoomStrength);
  }

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
        newImages.push({ asset, file, objectUrl });
      } catch (error) {
        URL.revokeObjectURL(objectUrl);
        objectUrlsRef.current.delete(objectUrl);
        setNotice(error instanceof Error ? error.message : "An image could not be decoded.");
      }
    }
    setImages((current) => [...current, ...sortNaturally(newImages)].map((item, order) => ({ ...item, asset: { ...item.asset, order, sequenceNumber: order + 1 } })));
    if (newImages.length) setNotice("Imported " + newImages.length + " image(s). Originals remain unchanged.");
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
      const cached = imageCacheRef.current.get(id);
      if (cached) cached.src = "";
      imageCacheRef.current.delete(id);
    }
    setImages((current) => current.filter((item) => item.asset.id !== id).map((item, order) => ({ ...item, asset: { ...item.asset, order, sequenceNumber: order + 1 } })));
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
    const transitionSeconds = transition === "cut" ? 0 : transitionDuration;
    const videoClipEdits: VideoClipEdit[] = timelineClips.map((clip, index) => ({
      clipId: clip.id,
      effect,
      transitionIn: index === 0 ? "cut" : transition,
      transitionOut: transition,
      transitionDurationSeconds: transitionSeconds,
      zoom: zoomStrength,
    }));
    const profileDimensions = outputDimensions(aspectRatio, outputSize);
    const renderProfile: RenderProfile = {
      ...profileDimensions,
      fps,
      aspectRatio,
      quality: "balanced",
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
      imageAssets: images.map((item, order) => ({
        ...item.asset,
        order,
        sequenceNumber: order + 1,
      })),
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

  const cancelRender = () => renderControllerRef.current?.abort();

  const clearImages = () => {
    if (rendering) return;
    images.forEach((item) => {
      URL.revokeObjectURL(item.objectUrl);
      objectUrlsRef.current.delete(item.objectUrl);
      const cached = imageCacheRef.current.get(item.asset.id);
      if (cached) cached.src = "";
      imageCacheRef.current.delete(item.asset.id);
    });
    setImages([]);
  };

  const previewTime = audioDuration > 0 ? formatTime(playhead) + " / " + formatTime(audioDuration) : "Import a soundtrack to set the full duration";
  const previewImage = images[currentIndex];

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
                onTimeUpdate={(event) => setPlayhead(event.currentTarget.currentTime)}
                onPlay={() => setPlaying(true)}
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
            {images.length ? <div className="motion-image-list">
              <div className="motion-list-header"><b>IMAGE ORDER</b><button type="button" disabled={rendering} onClick={clearImages}><Trash2 size={13} /> Clear all</button></div>
              {images.map((item, index) => <article className={index === currentIndex ? "motion-image-row active" : "motion-image-row"} key={item.asset.id}>
                <span className="motion-image-number">{String(index + 1).padStart(2, "0")}</span>
                <img src={item.objectUrl} alt="" />
                <div className="motion-image-info"><b title={item.asset.name}>{item.asset.name}</b><span>{item.asset.width} × {item.asset.height} · {(item.file.size / 1024 / 1024).toFixed(1)} MB</span></div>
                <div className="motion-image-hold">{audioDuration > 0 ? formatTime(secondsPerImage) : "—"}</div>
                <div className="motion-image-actions">
                  <button type="button" title="Move earlier" aria-label="Move image earlier" disabled={rendering || index === 0} onClick={() => moveImage(index, -1)}><ArrowUp size={13} /></button>
                  <button type="button" title="Move later" aria-label="Move image later" disabled={rendering || index === images.length - 1} onClick={() => moveImage(index, 1)}><ArrowDown size={13} /></button>
                  <button type="button" title="Remove image" aria-label="Remove image" disabled={rendering} onClick={() => removeImage(item.asset.id)}><Trash2 size={13} /></button>
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
            </div>
          </section>
        </div>

        <aside className="motion-studio-side-column">
          <section className="motion-panel motion-render-panel">
            <div className="motion-panel-heading"><div><span>03 · EXPORT</span><h2>Render your video</h2><p>Final rendering uses the local FFmpeg engine.</p></div></div>
            <label className="motion-field">Aspect ratio<select value={aspectRatio} disabled={rendering} onChange={(event) => setAspectRatio(event.target.value as AspectRatio)}><option value="16:9">16:9 · YouTube</option><option value="9:16">9:16 · Shorts / Reels</option><option value="1:1">1:1 · Square</option></select></label>
            <label className="motion-field">Resolution<select value={outputSize} disabled={rendering} onChange={(event) => setOutputSize(event.target.value as OutputSize)}><option value="1080p">1080p · Full HD</option><option value="720p">720p · HD</option></select></label>
            <label className="motion-field">Frame rate<select value={fps} disabled={rendering} onChange={(event) => setFps(Number(event.target.value))}><option value={24}>24 FPS · cinematic</option><option value={30}>30 FPS · standard</option><option value={60}>60 FPS · smooth</option></select></label>
            <div className="motion-audio-mix">
              <b><AudioLines size={14} /> SOUNDTRACK MIX</b>
              <label>Volume <span>{Math.round(soundtrackVolume * 100)}%</span><input type="range" min="0" max="1.5" step="0.05" disabled={rendering} value={soundtrackVolume} onChange={(event) => setSoundtrackVolume(Number(event.target.value))} /></label>
              <label>Fade in <span>{audioFadeIn.toFixed(1)}s</span><input type="range" min="0" max="5" step="0.1" disabled={rendering} value={audioFadeIn} onChange={(event) => setAudioFadeIn(Number(event.target.value))} /></label>
              <label>Fade out <span>{audioFadeOut.toFixed(1)}s</span><input type="range" min="0" max="10" step="0.1" disabled={rendering} value={audioFadeOut} onChange={(event) => setAudioFadeOut(Number(event.target.value))} /></label>
            </div>
            <div className="motion-renderer-connection">
              <b><ShieldCheck size={14} /> LOCAL RENDERER</b>
              <input aria-label="Local renderer URL" value={rendererUrl} disabled={rendering} onChange={(event) => { setRendererUrl(event.target.value); setRendererReady(false); }} />
              <button type="button" className="motion-secondary-button" onClick={() => void checkRenderer()} disabled={checkingRenderer || rendering}><RefreshCw size={13} /> {checkingRenderer ? "Checking…" : "Check connection"}</button>
              <p className={rendererReady ? "motion-renderer-status ready" : "motion-renderer-status"}>{rendererReady ? <CheckCircle2 size={13} /> : <span className="motion-status-dot" />}{rendererMessage}</p>
              {!rendererReady && <div className="motion-install-note"><b>Start the local engine</b><code>python local-render/server.py --allow-origin http://localhost:5173</code><small>For the deployed site, allow its exact HTTPS origin instead. Keep the sidecar running while rendering.</small></div>}
            </div>
            {rendering ? <div className="motion-job-status">
              <div><Loader2 size={15} /><b>{job?.status === "running" ? "Rendering locally" : "Preparing render"}</b><span>{Math.round(job?.progress ?? 0)}%</span></div>
              <div className="motion-progress"><span style={{ width: (job?.progress ?? 0) + "%" }} /></div>
              <p>{job?.message || "Packaging source files locally…"}</p>
              <button type="button" className="motion-cancel-button" onClick={cancelRender}><Square size={13} /> Cancel render</button>
            </div> : <button type="button" className="motion-render-button" disabled={!canRender || !rendererReady} onClick={() => void startRender()}><Clapperboard size={16} /> Render MP4 locally</button>}
            {notice && <p className="motion-notice" role="status">{notice}</p>}
          </section>
          <section className="motion-panel motion-limits-panel">
            <b><Sparkles size={14} /> WHAT THIS MODE DOES</b>
            <p>Creates movement with camera animation, zoom, pan and transitions. It does not use an AI image-to-video model or invent new subject motion.</p>
            <p>Particle overlays, layered parallax and keyframe-driven graphic elements are planned as separate effect layers.</p>
          </section>
        </aside>
      </div>
    </section>
  );
}
