import {
  addRationalTimes,
  normalizeRationalTime,
  rationalTimeToSeconds,
  type RationalTime,
} from "../domain/time";
import type { ParsedScene } from "./scriptParser";
import type { ImageSequenceAsset, SceneImageMapping } from "./imageSequence";
import type { SynchronizationMetadata, SyncSegment } from "./mediaTimeline";

export type TimelineClipKind = "image" | "narration" | "dialogue" | "music" | "sfx";

export interface ProductionTimelineClip {
  id: string;
  trackId: string;
  kind: TimelineClipKind;
  sceneId: string;
  blockId?: string;
  assetId?: string;
  audioSegmentId?: string;
  start: RationalTime;
  duration: RationalTime;
}

export interface ProductionTimelineTrack {
  id: string;
  name: string;
  kind: "video" | "audio";
  muted: boolean;
  solo: boolean;
  clips: ProductionTimelineClip[];
}

export interface ProductionTimeline {
  schema: "gridsplit.timeline";
  version: 1;
  frameRate: { num: number; den: number };
  duration: RationalTime;
  tracks: ProductionTimelineTrack[];
  warnings: string[];
  updatedAt: string;
}

export interface BuildProductionTimelineInput {
  scenes: ParsedScene[];
  images: ImageSequenceAsset[];
  mappings: SceneImageMapping[];
  synchronization: SynchronizationMetadata;
  defaultSceneDurationSeconds?: number;
  updatedAt?: string;
}

export interface BuildProductionTimelineResult {
  timeline: ProductionTimeline;
  warnings: string[];
}

const ZERO: RationalTime = { numerator: "0", denominator: "1" };

function sumDurations(segments: SyncSegment[]): RationalTime {
  return segments.reduce((total, segment) => addRationalTimes(total, segment.duration), ZERO);
}

function divideTime(value: RationalTime, divisor: number): RationalTime {
  if (!Number.isSafeInteger(divisor) || divisor <= 0) throw new RangeError("Timeline division must be positive.");
  return normalizeRationalTime(
    BigInt(value.numerator),
    BigInt(value.denominator) * BigInt(divisor),
  );
}

function multiplyTime(value: RationalTime, multiplier: number): RationalTime {
  return normalizeRationalTime(
    BigInt(value.numerator) * BigInt(multiplier),
    BigInt(value.denominator),
  );
}

function clipKindForBlock(kind: string | undefined): TimelineClipKind {
  if (kind === "dialogue") return "dialogue";
  if (kind === "music") return "music";
  if (kind === "sfx") return "sfx";
  return "narration";
}

/** Rebuild image/audio placement from measured WAV segment durations and scene mappings. */
export function buildProductionTimeline(input: BuildProductionTimelineInput): BuildProductionTimelineResult {
  const warnings: string[] = [];
  const imageIds = new Set(input.images.map((image) => image.id));
  const mappingByScene = new Map(input.mappings.map((mapping) => [mapping.sceneId, mapping.imageIds]));
  const segmentsByScene = new Map<string, SyncSegment[]>();
  for (const segment of input.synchronization.segments) {
    const group = segmentsByScene.get(segment.sceneId) ?? [];
    group.push(segment);
    segmentsByScene.set(segment.sceneId, group);
  }

  const videoTrack: ProductionTimelineTrack = {
    id: "track-video",
    name: "Images",
    kind: "video",
    muted: false,
    solo: false,
    clips: [],
  };
  const voiceTrack: ProductionTimelineTrack = {
    id: "track-voice",
    name: "Narration & dialogue",
    kind: "audio",
    muted: false,
    solo: false,
    clips: [],
  };
  const musicTrack: ProductionTimelineTrack = {
    id: "track-music-sfx",
    name: "Music & SFX",
    kind: "audio",
    muted: false,
    solo: false,
    clips: [],
  };

  let cursor = ZERO;
  for (const scene of input.scenes) {
    const sceneSegments = segmentsByScene.get(scene.id) ?? [];
    const expectedSpeech = scene.blocks.filter((block) =>
      (block.kind === "narration" || block.kind === "dialogue") && block.text.trim().length > 0);
    const readyBlocks = new Set(sceneSegments.map((segment) => segment.blockId));
    const missingSpeech = expectedSpeech.filter((block) => !readyBlocks.has(block.id)).length;
    if (missingSpeech > 0) {
      warnings.push(scene.title + ": " + missingSpeech + " speech block(s) have no measured local WAV and were omitted.");
    }

    let sceneDuration = sumDurations(sceneSegments);
    if (sceneSegments.length === 0) {
      const fallback = input.defaultSceneDurationSeconds ?? 5;
      if (!Number.isFinite(fallback) || fallback <= 0 || fallback > 300) {
        throw new RangeError("Fallback scene duration must be between 0 and 300 seconds.");
      }
      sceneDuration = normalizeRationalTime(Math.round(fallback * 1000), 1000);
      warnings.push(scene.title + ": no measured audio; using a " + fallback + " second placeholder duration.");
    }

    const configuredImages = mappingByScene.get(scene.id) ?? [];
    const selectedImages = configuredImages.filter((id) => imageIds.has(id));
    const missingImageRefs = configuredImages.length - selectedImages.length;
    if (missingImageRefs > 0) warnings.push(scene.title + ": " + missingImageRefs + " mapped image reference(s) are missing.");
    if (selectedImages.length === 0) {
      warnings.push(scene.title + ": no image is mapped; the video track will contain a gap.");
    } else {
      const imageDuration = divideTime(sceneDuration, selectedImages.length);
      selectedImages.forEach((assetId, index) => {
        videoTrack.clips.push({
          id: "image-" + scene.id + "-" + String(index + 1) + "-" + assetId,
          trackId: videoTrack.id,
          kind: "image",
          sceneId: scene.id,
          assetId,
          start: addRationalTimes(cursor, multiplyTime(imageDuration, index)),
          duration: imageDuration,
        });
      });
    }

    let audioCursor = cursor;
    for (const segment of sceneSegments) {
      const sourceBlock = scene.blocks.find((block) => block.id === segment.blockId);
      const kind = clipKindForBlock(sourceBlock?.kind);
      const track = kind === "music" || kind === "sfx" ? musicTrack : voiceTrack;
      track.clips.push({
        id: "audio-" + segment.id,
        trackId: track.id,
        kind,
        sceneId: scene.id,
        blockId: segment.blockId,
        audioSegmentId: segment.id,
        start: audioCursor,
        duration: segment.duration,
      });
      audioCursor = addRationalTimes(audioCursor, segment.duration);
    }
    cursor = addRationalTimes(cursor, sceneDuration);
  }

  const mappedIds = new Set(input.mappings.flatMap((mapping) => mapping.imageIds));
  const unassigned = input.images.filter((image) => !mappedIds.has(image.id)).length;
  if (unassigned > 0) warnings.push(unassigned + " image(s) are not assigned to a scene.");
  const staleMappings = input.mappings.filter((mapping) => !input.scenes.some((scene) => scene.id === mapping.sceneId)).length;
  if (staleMappings > 0) warnings.push(staleMappings + " mapping(s) point to deleted scenes.");

  const timeline: ProductionTimeline = {
    schema: "gridsplit.timeline",
    version: 1,
    frameRate: { num: 30, den: 1 },
    duration: cursor,
    tracks: [videoTrack, voiceTrack, musicTrack],
    warnings,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  };
  return { timeline, warnings };
}

function updateClip(
  timeline: ProductionTimeline,
  clipId: string,
  update: (clip: ProductionTimelineClip) => ProductionTimelineClip,
): ProductionTimeline {
  return {
    ...timeline,
    updatedAt: new Date().toISOString(),
    tracks: timeline.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => clip.id === clipId ? update(clip) : clip),
    })),
  };
}

export function shiftTimelineClip(
  timeline: ProductionTimeline,
  clipId: string,
  deltaMilliseconds: number,
): ProductionTimeline {
  if (!Number.isSafeInteger(deltaMilliseconds)) return timeline;
  return updateClip(timeline, clipId, (clip) => {
    const shifted = addRationalTimes(clip.start, normalizeRationalTime(deltaMilliseconds, 1000));
    return BigInt(shifted.numerator) < 0n ? clip : { ...clip, start: shifted };
  });
}

export function resizeTimelineClip(
  timeline: ProductionTimeline,
  clipId: string,
  deltaMilliseconds: number,
): ProductionTimeline {
  if (!Number.isSafeInteger(deltaMilliseconds)) return timeline;
  return updateClip(timeline, clipId, (clip) => {
    const next = addRationalTimes(clip.duration, normalizeRationalTime(deltaMilliseconds, 1000));
    return BigInt(next.numerator) <= 0n ? clip : { ...clip, duration: next };
  });
}

export function moveTimelineClipToTrack(
  timeline: ProductionTimeline,
  clipId: string,
  targetTrackId: string,
): ProductionTimeline {
  const sourceTrack = timeline.tracks.find((track) => track.clips.some((clip) => clip.id === clipId));
  const targetTrack = timeline.tracks.find((track) => track.id === targetTrackId);
  const clip = sourceTrack?.clips.find((item) => item.id === clipId);
  if (!sourceTrack || !targetTrack || !clip || sourceTrack.kind !== targetTrack.kind) return timeline;
  return {
    ...timeline,
    updatedAt: new Date().toISOString(),
    tracks: timeline.tracks.map((track) => {
      if (track.id === sourceTrack.id) return { ...track, clips: track.clips.filter((item) => item.id !== clipId) };
      if (track.id === targetTrack.id) return { ...track, clips: [...track.clips, { ...clip, trackId: targetTrack.id }] };
      return track;
    }),
  };
}

export function setTimelineTrackState(
  timeline: ProductionTimeline,
  trackId: string,
  patch: Partial<Pick<ProductionTimelineTrack, "muted" | "solo">>,
): ProductionTimeline {
  return {
    ...timeline,
    updatedAt: new Date().toISOString(),
    tracks: timeline.tracks.map((track) => track.id === trackId ? { ...track, ...patch } : track),
  };
}

export function timelineDurationSeconds(timeline: ProductionTimeline): number {
  return Math.max(0, rationalTimeToSeconds(timeline.duration));
}
