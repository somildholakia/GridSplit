export type MixTrackKind = "narration" | "dialogue" | "music" | "sfx";
export type TransitionKind = "cut" | "fade" | "dissolve" | "wipe-left" | "wipe-right";
export type ImageEffectKind = "none" | "ken-burns" | "pan-left" | "pan-right" | "zoom-in" | "zoom-out";
export type AspectRatio = "16:9" | "9:16" | "1:1";
export type ParticlePreset = "none" | "embers" | "snow" | "rain" | "confetti" | "magic";
export type RenderEncoder = "software" | "nvidia";

export interface MotionKeyframe {
  /** Normalized clip time from 0 to 1. */
  time: number;
  /** Camera zoom multiplier. */
  scale: number;
  /** Normalized crop origin from 0 (left/top) to 1 (right/bottom). */
  panX: number;
  panY: number;
  /** Rotation in degrees. */
  rotation: number;
}

export interface AudioMixTrack {
  id: string;
  kind: MixTrackKind;
  name: string;
  volume: number;
  muted: boolean;
  solo: boolean;
  fadeInSeconds: number;
  fadeOutSeconds: number;
}

export interface MixAudioAsset {
  id: string;
  name: string;
  mimeType: string;
  bytes: number;
  kind: "music" | "sfx";
  trackId: string;
  /** SFX follows the start of this scene; music remains timeline-wide. */
  sceneId?: string;
  /** Source script block allows generated cues to be reconciled and regenerated. */
  sourceBlockId?: string;
  sourceSceneId?: string;
  startSeconds: number;
  durationSeconds: number;
  order: number;
}

export interface VideoClipEdit {
  clipId: string;
  effect: ImageEffectKind;
  transitionIn: TransitionKind;
  transitionOut: TransitionKind;
  transitionDurationSeconds: number;
  zoom: number;
  /** Optional authored transform keys; when present these override the motion preset. */
  keyframes?: MotionKeyframe[];
  /** Optional procedural overlay generated during FFmpeg rendering. */
  particlePreset?: ParticlePreset;
  particleIntensity?: number;
  /** Transparent foreground cutout image to move separately from the background. */
  parallaxAssetId?: string;
  parallaxAmount?: number;
}

export interface RenderProfile {
  width: number;
  height: number;
  fps: number;
  aspectRatio: AspectRatio;
  quality: "high" | "balanced" | "compact";
  /** NVIDIA NVENC is selected only by the optional Colab/T4 export workflow. */
  encoder?: RenderEncoder;
}

export interface GainPoint {
  timeSeconds: number;
  gain: number;
}

export interface RenderIssue {
  code: string;
  message: string;
  severity: "error" | "warning";
}

export const DEFAULT_RENDER_PROFILE: RenderProfile = {
  width: 1920,
  height: 1080,
  fps: 30,
  aspectRatio: "16:9",
  quality: "balanced",
};

const TRACK_DEFAULTS: Array<Omit<AudioMixTrack, "id">> = [
  { kind: "narration", name: "Narration", volume: 1, muted: false, solo: false, fadeInSeconds: 0, fadeOutSeconds: 0 },
  { kind: "dialogue", name: "Dialogue", volume: 1, muted: false, solo: false, fadeInSeconds: 0, fadeOutSeconds: 0 },
  { kind: "music", name: "Music", volume: 0.35, muted: false, solo: false, fadeInSeconds: 1, fadeOutSeconds: 2 },
  { kind: "sfx", name: "Sound effects", volume: 0.8, muted: false, solo: false, fadeInSeconds: 0, fadeOutSeconds: 0 },
];

export function createDefaultAudioMixTracks(makeId: () => string = () => crypto.randomUUID()): AudioMixTrack[] {
  return TRACK_DEFAULTS.map((track) => ({ ...track, id: makeId() }));
}

export function normalizeAudioMixTracks(value: unknown, makeId: () => string = () => crypto.randomUUID()): AudioMixTrack[] {
  const records = Array.isArray(value) ? value : [];
  const byKind = new Map<MixTrackKind, AudioMixTrack>();
  for (const item of records) {
    if (!isRecord(item) || !isMixTrackKind(item.kind)) continue;
    const volume = Number(item.volume);
    const fadeIn = Number(item.fadeInSeconds);
    const fadeOut = Number(item.fadeOutSeconds);
    const id = typeof item.id === "string" && item.id.trim() ? item.id : makeId();
    byKind.set(item.kind, {
      id,
      kind: item.kind,
      name: typeof item.name === "string" && item.name.trim() ? item.name.slice(0, 80) : TRACK_DEFAULTS.find((t) => t.kind === item.kind)!.name,
      volume: clamp(Number.isFinite(volume) ? volume : 1, 0, 2),
      muted: item.muted === true,
      solo: item.solo === true,
      fadeInSeconds: clamp(Number.isFinite(fadeIn) ? fadeIn : 0, 0, 30),
      fadeOutSeconds: clamp(Number.isFinite(fadeOut) ? fadeOut : 0, 0, 30),
    });
  }
  return TRACK_DEFAULTS.map((defaults) => ({
    ...defaults,
    ...(byKind.get(defaults.kind) ?? {}),
    id: byKind.get(defaults.kind)?.id ?? makeId(),
  }));
}

export function isAudioMixTrack(value: unknown): value is AudioMixTrack {
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && isMixTrackKind(value.kind)
    && typeof value.name === "string"
    && isFiniteInRange(value.volume, 0, 2)
    && typeof value.muted === "boolean"
    && typeof value.solo === "boolean"
    && isFiniteInRange(value.fadeInSeconds, 0, 30)
    && isFiniteInRange(value.fadeOutSeconds, 0, 30);
}

export function isMixAudioAsset(value: unknown): value is MixAudioAsset {
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && typeof value.name === "string"
    && typeof value.mimeType === "string"
    && value.mimeType.startsWith("audio/")
    && isFiniteInRange(value.bytes, 1, Number.MAX_SAFE_INTEGER)
    && (value.kind === "music" || value.kind === "sfx")
    && typeof value.trackId === "string"
    && (value.sceneId === undefined || typeof value.sceneId === "string")
    && (value.sourceBlockId === undefined || typeof value.sourceBlockId === "string")
    && (value.sourceSceneId === undefined || typeof value.sourceSceneId === "string")
    && isFiniteInRange(value.startSeconds, 0, 24 * 60 * 60)
    && isFiniteInRange(value.durationSeconds, 0.01, 24 * 60 * 60)
    && Number.isSafeInteger(value.order)
    && Number(value.order) >= 0;
}

export function isVideoClipEdit(value: unknown): value is VideoClipEdit {
  if (!isRecord(value)) return false;
  return typeof value.clipId === "string"
    && isEffectKind(value.effect)
    && isTransitionKind(value.transitionIn)
    && isTransitionKind(value.transitionOut)
    && isFiniteInRange(value.transitionDurationSeconds, 0, 5)
    && isFiniteInRange(value.zoom, 1, 1.5)
    && (value.keyframes === undefined || isMotionKeyframeSequence(value.keyframes))
    && (value.particlePreset === undefined || isParticlePreset(value.particlePreset))
    && (value.particleIntensity === undefined || isFiniteInRange(value.particleIntensity, 0, 100))
    && (value.parallaxAssetId === undefined || (typeof value.parallaxAssetId === "string" && value.parallaxAssetId.trim().length > 0))
    && (value.parallaxAmount === undefined || isFiniteInRange(value.parallaxAmount, 0, 100));
}

export function isRenderProfile(value: unknown): value is RenderProfile {
  if (!isRecord(value)) return false;
  return Number.isSafeInteger(value.width)
    && Number(value.width) >= 320 && Number(value.width) <= 3840
    && Number.isSafeInteger(value.height)
    && Number(value.height) >= 320 && Number(value.height) <= 3840
    && Number.isFinite(value.fps)
    && [23.976, 24, 25, 29.97, 30, 50, 59.94, 60].some((fps) => Math.abs(Number(value.fps) - fps) < 0.001)
    && ["16:9", "9:16", "1:1"].includes(String(value.aspectRatio))
    && ["high", "balanced", "compact"].includes(String(value.quality))
    && (value.encoder === undefined || value.encoder === "software" || value.encoder === "nvidia");
}

function isMotionKeyframeSequence(value: unknown): value is MotionKeyframe[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 32) return false;
  return value.every((item, index) => isMotionKeyframe(item)
    && (index === 0 || item.time > (value[index - 1] as MotionKeyframe).time));
}

export function isMotionKeyframe(value: unknown): value is MotionKeyframe {
  if (!isRecord(value)) return false;
  return isFiniteInRange(value.time, 0, 1)
    && isFiniteInRange(value.scale, 1, 1.5)
    && isFiniteInRange(value.panX, 0, 1)
    && isFiniteInRange(value.panY, 0, 1)
    && isFiniteInRange(value.rotation, -25, 25);
}

export function isParticlePreset(value: unknown): value is ParticlePreset {
  return value === "none" || value === "embers" || value === "snow" || value === "rain"
    || value === "confetti" || value === "magic";
}

export function isMixTrackKind(value: unknown): value is MixTrackKind {
  return value === "narration" || value === "dialogue" || value === "music" || value === "sfx";
}
export function isTransitionKind(value: unknown): value is TransitionKind {
  return value === "cut" || value === "fade" || value === "dissolve" || value === "wipe-left" || value === "wipe-right";
}
export function isEffectKind(value: unknown): value is ImageEffectKind {
  return value === "none" || value === "ken-burns" || value === "pan-left" || value === "pan-right" || value === "zoom-in" || value === "zoom-out";
}

/** Resolve mute/solo precedence once so preview and FFmpeg receive identical track state. */
export function audibleTrackIds(tracks: AudioMixTrack[]): Set<string> {
  const soloed = tracks.filter((track) => track.solo && !track.muted);
  return new Set((soloed.length ? soloed : tracks.filter((track) => !track.muted)).map((track) => track.id));
}

/** Gain automation is bounded and sample-independent; renderers apply it at their native sample rate. */
export function buildGainAutomation(
  durationSeconds: number,
  volume: number,
  fadeInSeconds = 0,
  fadeOutSeconds = 0,
): GainPoint[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return [];
  const gain = clamp(Number.isFinite(volume) ? volume : 1, 0, 2);
  let fadeIn = clamp(Number.isFinite(fadeInSeconds) ? fadeInSeconds : 0, 0, durationSeconds);
  let fadeOut = clamp(Number.isFinite(fadeOutSeconds) ? fadeOutSeconds : 0, 0, durationSeconds);
  const combinedFades = fadeIn + fadeOut;
  if (combinedFades > durationSeconds && combinedFades > 0) {
    const scale = durationSeconds / combinedFades;
    fadeIn *= scale;
    fadeOut *= scale;
  }
  const points: GainPoint[] = [{ timeSeconds: 0, gain: fadeIn > 0 ? 0 : gain }];
  if (fadeIn > 0) points.push({ timeSeconds: fadeIn, gain });
  if (fadeOut > 0) {
    const start = Math.max(fadeIn, durationSeconds - fadeOut);
    if (start > points[points.length - 1].timeSeconds) points.push({ timeSeconds: start, gain });
    points.push({ timeSeconds: durationSeconds, gain: 0 });
  } else if (durationSeconds > points[points.length - 1].timeSeconds) {
    points.push({ timeSeconds: durationSeconds, gain });
  }
  return points;
}

export function validateRenderProfile(profile: RenderProfile): RenderIssue[] {
  const issues: RenderIssue[] = [];
  if (!isRenderProfile(profile)) {
    issues.push({ code: "invalid-profile", severity: "error", message: "Choose a supported resolution, frame rate, aspect ratio, and quality preset." });
    return issues;
  }
  if (profile.width % 2 !== 0 || profile.height % 2 !== 0) {
    issues.push({ code: "odd-dimensions", severity: "error", message: "H.264 4:2:0 output requires even width and height." });
  }
  const ratio = profile.width / profile.height;
  const expected = profile.aspectRatio === "16:9" ? 16 / 9 : profile.aspectRatio === "9:16" ? 9 / 16 : 1;
  if (Math.abs(ratio - expected) > 0.015) {
    issues.push({ code: "aspect-mismatch", severity: "error", message: "The selected aspect ratio does not match the output dimensions." });
  }
  return issues;
}

export interface RenderTimelineInput {
  imageClips: Array<{ id: string; assetId?: string; startSeconds: number; durationSeconds: number }>;
  imageAssetIds: string[];
  audioAssetIds: string[];
  mixAssets: MixAudioAsset[];
  profile: RenderProfile;
}

export function validateRenderTimeline(input: RenderTimelineInput): RenderIssue[] {
  const issues = [...validateRenderProfile(input.profile)];
  if (!input.imageClips.length) {
    issues.push({ code: "no-video-clips", severity: "error", message: "Add image clips to the timeline before rendering." });
  }
  const availableImages = new Set(input.imageAssetIds);
  const ordered = [...input.imageClips].sort((left, right) => left.startSeconds - right.startSeconds);
  let previousEnd = 0;
  for (const clip of ordered) {
    if (!clip.assetId || !availableImages.has(clip.assetId)) {
      issues.push({ code: "missing-image", severity: "error", message: "An image clip references a missing source image." });
    }
    if (!Number.isFinite(clip.startSeconds) || clip.startSeconds < 0 || !Number.isFinite(clip.durationSeconds) || clip.durationSeconds <= 0) {
      issues.push({ code: "invalid-clip", severity: "error", message: "A video clip has an invalid start time or duration." });
      continue;
    }
    if (clip.startSeconds - previousEnd > 0.05) {
      issues.push({ code: "timeline-gap", severity: "warning", message: "The image timeline contains a gap; the renderer will fill it with black." });
    }
    previousEnd = Math.max(previousEnd, clip.startSeconds + clip.durationSeconds);
  }
  const readyMix = input.mixAssets.filter((asset) => !input.audioAssetIds.includes(asset.id));
  for (const asset of readyMix) {
    issues.push({ code: "missing-mix-audio", severity: "warning", message: "An audio track asset is not present in local storage: " + asset.name });
  }
  return issues;
}

export function ffmpegTransitionName(kind: TransitionKind): string | null {
  switch (kind) {
    case "fade": return "fade";
    case "dissolve": return "fade";
    case "wipe-left": return "wipeleft";
    case "wipe-right": return "wiperight";
    default: return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isFiniteInRange(value: unknown, min: number, max: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
