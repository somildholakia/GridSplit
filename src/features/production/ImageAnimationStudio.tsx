import { useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, Download, Square, Sparkles, Video } from "lucide-react";
import type { SequenceAsset } from "./productionModel";
import "./image-animation-studio.css";

type MotionPreset = "ken-burns" | "zoom-out" | "pan-left" | "pan-right" | "float" | "cinematic";
type Props = {
  images: SequenceAsset[];
  imageUrls: Record<string, string>;
  onImportFiles: (files: FileList | null) => void;
};
type LoadedImage = { id: string; name: string; image: HTMLImageElement };

const PRESETS: Array<{ value: MotionPreset; label: string }> = [
  { value: "ken-burns", label: "Ken Burns · slow zoom" },
  { value: "zoom-out", label: "Zoom out" },
  { value: "pan-left", label: "Pan left" },
  { value: "pan-right", label: "Pan right" },
  { value: "float", label: "Floating motion" },
  { value: "cinematic", label: "Cinematic drift" },
];

function loadImage(id: string, name: string, src: string): Promise<LoadedImage> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ id, name, image });
    image.onerror = () => reject(new Error(`Could not load ${name}. Re-import the image and try again.`));
    image.src = src;
  });
}

function drawMotion(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  preset: MotionPreset,
  progress: number,
  intensity: number,
  alpha = 1,
) {
  const width = context.canvas.width;
  const height = context.canvas.height;
  const strength = Math.max(0, Math.min(1, intensity / 100));
  const cover = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const extra = 1.04 + strength * 0.16;
  let zoom = extra;
  let offsetX = 0;
  let offsetY = 0;
  let rotation = 0;

  if (preset === "zoom-out") zoom = extra * (1.12 - progress * 0.1);
  if (preset === "ken-burns") zoom = extra * (1 + progress * 0.1);
  if (preset === "pan-left") {
    zoom = extra * 1.08;
    offsetX = (0.5 - progress) * width * 0.12 * strength;
  }
  if (preset === "pan-right") {
    zoom = extra * 1.08;
    offsetX = (progress - 0.5) * width * 0.12 * strength;
  }
  if (preset === "float") {
    zoom = extra * 1.08;
    offsetY = Math.sin(progress * Math.PI * 2) * height * 0.025 * strength;
    rotation = Math.sin(progress * Math.PI * 2) * 0.006 * strength;
  }
  if (preset === "cinematic") {
    zoom = extra * (1.02 + progress * 0.12);
    offsetX = (progress - 0.5) * width * 0.07 * strength;
    offsetY = (0.5 - progress) * height * 0.035 * strength;
    rotation = (progress - 0.5) * 0.012 * strength;
  }

  const drawWidth = image.naturalWidth * cover * zoom;
  const drawHeight = image.naturalHeight * cover * zoom;
  context.save();
  context.globalAlpha = alpha;
  context.translate(width / 2 + offsetX, height / 2 + offsetY);
  context.rotate(rotation);
  context.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  context.restore();
}

function supportedRecordingType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const options = ["video/mp4;codecs=avc1.42E01E", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  return options.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

export default function ImageAnimationStudio({ images, imageUrls, onImportFiles }: Props) {
  const [selectedId, setSelectedId] = useState("");
  const [scope, setScope] = useState<"selected" | "all">("selected");
  const [preset, setPreset] = useState<MotionPreset>("ken-burns");
  const [duration, setDuration] = useState(3);
  const [intensity, setIntensity] = useState(45);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [outputUrl, setOutputUrl] = useState("");
  const [outputName, setOutputName] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const cancelRef = useRef(false);
  const outputUrlRef = useRef("");

  useEffect(() => {
    if (!images.some((image) => image.id === selectedId)) setSelectedId(images[0]?.id ?? "");
  }, [images, selectedId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let frame = 0;
    let raf = 0;
    let loaded: LoadedImage | null = null;
    let disposed = false;
    const selected = images.find((image) => image.id === selectedId) ?? images[0];
    const src = selected ? imageUrls[selected.id] : undefined;
    if (!selected || !src) {
      const context = canvas.getContext("2d");
      context?.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    void loadImage(selected.id, selected.name, src).then((result) => {
      if (disposed) return;
      loaded = result;
      const context = canvas.getContext("2d");
      if (!context) return;
      const draw = (timestamp: number) => {
        if (disposed || !loaded) return;
        if (!frame) frame = timestamp;
        const elapsed = (timestamp - frame) / 1000;
        const context2d = canvas.getContext("2d");
        if (context2d) {
          const phase = (elapsed % duration) / duration;
          drawMotion(context2d, loaded.image, preset, phase, intensity);
        }
        raf = requestAnimationFrame(draw);
      };
      raf = requestAnimationFrame(draw);
    }).catch((error: unknown) => {
      if (!disposed) setMessage(error instanceof Error ? error.message : "Preview could not be loaded.");
    });
    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
    };
  }, [images, imageUrls, selectedId, preset, intensity, duration]);

  useEffect(() => () => {
    cancelRef.current = true;
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
    if (outputUrlRef.current) URL.revokeObjectURL(outputUrlRef.current);
  }, []);

  const selectedImages = useMemo(() => {
    const source = scope === "all" ? images : images.filter((image) => image.id === selectedId);
    return source.filter((image) => Boolean(imageUrls[image.id])).sort((left, right) => left.order - right.order);
  }, [images, imageUrls, scope, selectedId]);

  const totalDuration = selectedImages.length * duration;
  const startExport = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !selectedImages.length) {
      setMessage("Import at least one image before exporting an animation.");
      return;
    }
    if (typeof MediaRecorder === "undefined" || !("captureStream" in canvas)) {
      setMessage("This browser does not support canvas video recording. Try the latest Chrome or Edge.");
      return;
    }

    cancelRef.current = false;
    setExporting(true);
    setProgress(0);
    setMessage("Preparing local image frames…");
    let stream: MediaStream | null = null;
    let recorder: MediaRecorder | null = null;
    let stopped: Promise<Blob | null> | null = null;
    try {
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas rendering is unavailable in this browser.");
      // Keep at most the current and next decoded image in memory. This avoids
      // decoding hundreds of full-resolution images together for large projects.
      let current = await loadImage(selectedImages[0].id, selectedImages[0].name, imageUrls[selectedImages[0].id]);
      stream = canvas.captureStream(30);
      const mimeType = supportedRecordingType();
      recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 6_000_000 } : undefined);
      recorderRef.current = recorder;
      const chunks: BlobPart[] = [];
      const actualType = mimeType || "video/webm";
      stopped = new Promise<Blob | null>((resolve, reject) => {
        recorder!.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
        recorder!.onerror = () => reject(new Error("Browser video recording failed."));
        recorder!.onstop = () => {
          stream?.getTracks().forEach((track) => track.stop());
          if (cancelRef.current) resolve(null);
          else resolve(new Blob(chunks, { type: recorder!.mimeType || actualType }));
        };
      });

      recorder.start(1000);
      setMessage(`Rendering ${selectedImages.length} image(s) locally in this browser. The export runs in real time.`);
      const fadeSeconds = Math.min(0.65, duration / 4);
      let lastPercent = -1;

      for (let imageIndex = 0; imageIndex < selectedImages.length; imageIndex += 1) {
        if (cancelRef.current) break;
        let nextImage: LoadedImage | null = null;
        let nextError: unknown = null;
        const nextPromise = imageIndex + 1 < selectedImages.length
          ? loadImage(selectedImages[imageIndex + 1].id, selectedImages[imageIndex + 1].name, imageUrls[selectedImages[imageIndex + 1].id])
              .then((loaded) => { nextImage = loaded; return loaded; })
              .catch((error: unknown) => { nextError = error; throw error; })
          : null;
        // Attach a rejection handler immediately; the awaited promise below
        // still propagates the original failure after the current frame.
        void nextPromise?.catch(() => undefined);

        const segmentStart = performance.now();
        await new Promise<void>((resolve) => {
          const tick = (timestamp: number) => {
            if (cancelRef.current) { resolve(); return; }
            const elapsed = Math.min(duration, Math.max(0, (timestamp - segmentStart) / 1000));
            const local = elapsed / duration;
            context.fillStyle = "#080b10";
            context.fillRect(0, 0, canvas.width, canvas.height);
            drawMotion(context, current.image, preset, local, intensity);
            const fading = local > 1 - fadeSeconds / duration && imageIndex < selectedImages.length - 1;
            if (fading && nextImage) {
              const alpha = (local - (1 - fadeSeconds / duration)) / (fadeSeconds / duration);
              drawMotion(context, nextImage.image, preset, 0, intensity, Math.min(1, Math.max(0, alpha)));
            }
            const fraction = Math.min(1, (imageIndex * duration + elapsed) / totalDuration);
            const percent = Math.floor(fraction * 100);
            if (percent !== lastPercent) {
              lastPercent = percent;
              setProgress(fraction);
            }
            if (elapsed >= duration) { resolve(); return; }
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });

        current.image.src = "";
        if (cancelRef.current) {
          if (nextImage) nextImage.image.src = "";
          break;
        }
        if (nextPromise) {
          try {
            current = await nextPromise;
          } catch (error) {
            throw nextError ?? error;
          }
        }
      }

      current.image.src = "";
      if (recorder.state !== "inactive") recorder.stop();
      const blob = await stopped;
      if (blob && blob.size) {
        if (outputUrlRef.current) URL.revokeObjectURL(outputUrlRef.current);
        const url = URL.createObjectURL(blob);
        outputUrlRef.current = url;
        setOutputUrl(url);
        const extension = blob.type.includes("mp4") ? "mp4" : "webm";
        setOutputName(`gridsplit-image-animation.${extension}`);
        setMessage(`Animation exported: ${selectedImages.length} image(s), ${Math.round(totalDuration)} seconds, ${(blob.size / 1024 / 1024).toFixed(1)} MB.`);
        setProgress(1);
      } else {
        setMessage("Animation export cancelled. Your original images were not changed.");
      }
    } catch (error) {
      if (recorder && recorder.state !== "inactive") recorder.stop();
      else stream?.getTracks().forEach((track) => track.stop());
      setMessage(error instanceof Error ? error.message : "Could not render this animation.");
    } finally {
      recorderRef.current = null;
      setExporting(false);
    }
  };

  const cancelExport = () => {
    cancelRef.current = true;
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
  };
  const download = () => {
    if (!outputUrl) return;
    const link = document.createElement("a");
    link.href = outputUrl;
    link.download = outputName || "gridsplit-image-animation.webm";
    link.click();
  };

  return <section className="image-animation-studio">
    <header className="image-animation-heading">
      <div><span>IMAGE ANIMATION · BROWSER RENDERER</span><h3>Give still images <em>camera movement.</em></h3>
        <p>Animate images with zoom, pan, drift and crossfades. No AI API, account, upload, server job or extra installation is required.</p></div>
      <label className="image-animation-import"><ImagePlus size={14}/> Add images<input type="file" accept="image/*" multiple onChange={(event) => { onImportFiles(event.target.files); event.currentTarget.value = ""; }}/></label>
    </header>
    <div className="image-animation-layout">
      <div className="image-animation-preview">
        <div className="image-animation-canvas-wrap">
          <canvas ref={canvasRef} width={1280} height={720} aria-label="Animated image preview"/>
          {!images.length && <div className="image-animation-empty"><Video size={24}/><b>Add storyboard images</b><span>Preview and animate them here.</span></div>}
        </div>
        <div className="image-animation-preview-footer"><span>{images.length.toLocaleString()} images in this project</span><span>1280 × 720 · 30 FPS</span></div>
      </div>
      <div className="image-animation-settings">
        <label>Image to animate<select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
          {!images.length && <option value="">No images available</option>}
          {images.map((image) => <option key={image.id} value={image.id}>{image.order + 1}. {image.name}</option>)}
        </select></label>
        <label>Export scope<select value={scope} onChange={(event) => setScope(event.target.value as "selected" | "all")}>
          <option value="selected">Selected image only</option><option value="all">All project images · sequence order</option>
        </select></label>
        <label>Motion preset<select value={preset} onChange={(event) => setPreset(event.target.value as MotionPreset)}>
          {PRESETS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select></label>
        <label className="image-animation-range"><span>Duration per image <b>{duration}s</b></span><input type="range" min="3" max="60" step="1" value={duration} onChange={(event) => setDuration(Number(event.target.value))}/></label>
        <label className="image-animation-range"><span>Motion intensity <b>{intensity}%</b></span><input type="range" min="0" max="100" step="5" value={intensity} onChange={(event) => setIntensity(Number(event.target.value))}/></label>
        <div className="image-animation-summary"><span>{selectedImages.length.toLocaleString()} selected image(s)</span><b>{Math.floor(totalDuration / 60)}m {Math.round(totalDuration % 60)}s total</b></div>
        {exporting ? <button className="image-animation-primary" onClick={cancelExport}><Square size={14}/> Cancel export</button>
          : <button className="image-animation-primary" disabled={!selectedImages.length} onClick={() => void startExport()}><Sparkles size={14}/> Render animation</button>}
        {exporting && <div className="image-animation-progress"><div><span>Rendering in browser</span><b>{Math.round(progress * 100)}%</b></div><progress max={1} value={progress}/></div>}
        {outputUrl && !exporting && <button className="image-animation-download" onClick={download}><Download size={14}/> Download {outputName.toUpperCase()}</button>}
        {message && <p className="image-animation-message" role="status">{message}</p>}
        <p className="image-animation-note">This creates camera-style motion from the original pixels. It does not invent walking, facial expressions, object movement or other AI-generated motion. Long exports render in real time; a 60-minute video takes about 60 minutes to record.</p>
      </div>
    </div>
  </section>;
}
