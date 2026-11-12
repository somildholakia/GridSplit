import type { ImageEffectKind, MotionKeyframe } from "../../domain/production";

export function createPresetKeyframes(effect: ImageEffectKind, zoom: number): MotionKeyframe[] {
  const scale = Math.max(1, Math.min(1.5, zoom));
  switch (effect) {
    case "zoom-out": return [
      { time: 0, scale, panX: 0.5, panY: 0.5, rotation: 0 },
      { time: 1, scale: 1, panX: 0.5, panY: 0.5, rotation: 0 },
    ];
    case "pan-left": return [
      { time: 0, scale: Math.max(1.05, scale), panX: 1, panY: 0.5, rotation: 0 },
      { time: 1, scale: Math.max(1.05, scale), panX: 0, panY: 0.5, rotation: 0 },
    ];
    case "pan-right": return [
      { time: 0, scale: Math.max(1.05, scale), panX: 0, panY: 0.5, rotation: 0 },
      { time: 1, scale: Math.max(1.05, scale), panX: 1, panY: 0.5, rotation: 0 },
    ];
    case "ken-burns": return [
      { time: 0, scale: 1.04, panX: 0.43, panY: 0.55, rotation: 0 },
      { time: 1, scale, panX: 0.57, panY: 0.45, rotation: 0 },
    ];
    case "zoom-in": return [
      { time: 0, scale: 1, panX: 0.5, panY: 0.5, rotation: 0 },
      { time: 1, scale, panX: 0.5, panY: 0.5, rotation: 0 },
    ];
    default: return [
      { time: 0, scale: 1, panX: 0.5, panY: 0.5, rotation: 0 },
      { time: 1, scale: 1, panX: 0.5, panY: 0.5, rotation: 0 },
    ];
  }
}

export function sampleMotionKeyframes(keyframes: MotionKeyframe[], progress: number): MotionKeyframe {
  if (!keyframes.length) return { time: progress, scale: 1, panX: 0.5, panY: 0.5, rotation: 0 };
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  const time = Math.max(0, Math.min(1, progress));
  if (time <= sorted[0].time) return { ...sorted[0], time };
  const last = sorted[sorted.length - 1];
  if (time >= last.time) return { ...last, time };
  const nextIndex = sorted.findIndex((keyframe) => keyframe.time >= time);
  const left = sorted[Math.max(0, nextIndex - 1)];
  const right = sorted[nextIndex];
  const span = Math.max(0.000001, right.time - left.time);
  const amount = (time - left.time) / span;
  const lerp = (a: number, b: number) => a + (b - a) * amount;
  return {
    time,
    scale: lerp(left.scale, right.scale),
    panX: lerp(left.panX, right.panX),
    panY: lerp(left.panY, right.panY),
    rotation: lerp(left.rotation, right.rotation),
  };
}

export function insertMotionKeyframe(keyframes: MotionKeyframe[], keyframe: MotionKeyframe): MotionKeyframe[] {
  const next = [...keyframes].filter((item) => Math.abs(item.time - keyframe.time) > 0.0001);
  next.push(keyframe);
  return next.sort((a, b) => a.time - b.time).slice(0, 32);
}

export type ParticlePreset = "none" | "embers" | "snow" | "rain" | "confetti" | "magic";
export function normalizeParticlePreset(value: string): ParticlePreset {
  return ["embers", "snow", "rain", "confetti", "magic"].includes(value) ? value as ParticlePreset : "none";
}
