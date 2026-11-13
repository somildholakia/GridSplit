import type { ImageEffectKind, MotionKeyframe, ParticlePreset } from "../../domain/production";
import { sampleMotionKeyframes } from "./motionLayers";

export function drawMotionFrame(
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

export function drawParticlePreview(
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



/**
 * Parameters for an SVG noise threshold that mirrors FFmpeg xfade=dissolve:
 * incoming pixels are revealed when their stable noise value is below progress.
 * The linear stage maps the transition threshold to 0.5; a following discrete
 * transfer converts that into a hard per-pixel reveal mask.
 */
export function getMotionDissolveFilterParameters(progress: number): { slope: number; intercept: number } {
  const safeProgress = Math.min(0.99999, Math.max(0, Number.isFinite(progress) ? progress : 0));
  const inverseRemaining = 1 / (1 - safeProgress);
  return {
    slope: -0.5 * inverseRemaining,
    intercept: 0.5 * inverseRemaining,
  };
}
