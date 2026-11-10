import { readWavMetadata, type WavMetadata } from "../audio/wav";
import { addRationalTimes, rationalTimeFromSamples, rationalTimeToSeconds, type RationalTime } from "../domain/time";

export interface MeasuredAudio {
  sampleCount: number;
  sampleRate: number;
  channels: number;
  duration: RationalTime;
  durationSeconds: number;
}

/** Re-read the actual WAV header; never trust a provider's estimated duration. */
export async function measureWavBlob(blob: Blob): Promise<MeasuredAudio & WavMetadata> {
  if (!(blob instanceof Blob) || blob.size < 44) throw new Error("The audio segment is not a complete WAV file.");
  const metadata = readWavMetadata(await blob.arrayBuffer());
  const duration = rationalTimeFromSamples(metadata.sampleCount, metadata.sampleRate);
  return { ...metadata, duration, durationSeconds: rationalTimeToSeconds(duration) };
}

export interface SyncSegmentInput {
  id: string;
  sceneId: string;
  blockId: string;
  text: string;
  speaker?: string;
  sampleCount: number;
  sampleRate: number;
  channels?: number;
}
export interface SyncSegment {
  id: string;
  sceneId: string;
  blockId: string;
  text: string;
  speaker?: string;
  sampleCount: number;
  sampleRate: number;
  channels?: number;
  start: RationalTime;
  end: RationalTime;
  duration: RationalTime;
}
export interface SyncScene {
  sceneId: string;
  start: RationalTime;
  end: RationalTime;
  segmentIds: string[];
}
export interface SynchronizationMetadata {
  schema: "gridsplit.sync";
  version: 1;
  timebase: "exact-rational-seconds";
  segments: SyncSegment[];
  scenes: SyncScene[];
  totalDuration: RationalTime;
  totalDurationSeconds: number;
}

/** Build a sequential, reproducible timeline in the supplied scene/block order. */
export function buildSynchronizationMetadata(inputs: SyncSegmentInput[]): SynchronizationMetadata {
  let cursor: RationalTime = { numerator: "0", denominator: "1" };
  const segments: SyncSegment[] = [];
  const scenes: SyncScene[] = [];
  const sceneById = new Map<string, SyncScene>();
  const seen = new Set<string>();

  for (const input of inputs) {
    if (!input.id || !input.sceneId || !input.blockId || seen.has(input.id)) {
      throw new Error("Synchronization segments must have unique, non-empty IDs and references.");
    }
    seen.add(input.id);
    if (!Number.isSafeInteger(input.sampleCount) || input.sampleCount <= 0 ||
        !Number.isSafeInteger(input.sampleRate) || input.sampleRate <= 0) {
      throw new Error("Every synchronized segment needs a positive sample count and sample rate.");
    }
    const duration = rationalTimeFromSamples(input.sampleCount, input.sampleRate);
    const start = cursor;
    const end = addRationalTimes(start, duration);
    const segment: SyncSegment = { ...input, start, end, duration };
    segments.push(segment);
    let scene = sceneById.get(input.sceneId);
    if (!scene) {
      scene = { sceneId: input.sceneId, start, end, segmentIds: [] };
      sceneById.set(input.sceneId, scene);
      scenes.push(scene);
    }
    scene.end = end;
    scene.segmentIds.push(input.id);
    cursor = end;
  }

  return {
    schema: "gridsplit.sync",
    version: 1,
    timebase: "exact-rational-seconds",
    segments,
    scenes,
    totalDuration: cursor,
    totalDurationSeconds: rationalTimeToSeconds(cursor),
  };
}

function timestamp(milliseconds: number, decimalSeparator: "," | "."): string {
  const safe = Math.max(0, Math.floor(milliseconds));
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1_000);
  const millis = safe % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${decimalSeparator}${String(millis).padStart(3, "0")}`;
}

function cueText(segment: SyncSegment): string {
  const text = segment.text.replace(/\r\n?/g, "\n").trim();
  if (!text) return "";
  return segment.speaker ? `${segment.speaker}: ${text}` : text;
}

/** Segment-level captions only; this intentionally does not invent word alignment. */
export function toSrt(metadata: SynchronizationMetadata): string {
  return metadata.segments.flatMap((segment, index) => {
    const text = cueText(segment);
    if (!text) return [];
    const startMs = Math.floor(rationalTimeToSeconds(segment.start) * 1000);
    const endMs = Math.ceil(rationalTimeToSeconds(segment.end) * 1000);
    return [`${index + 1}\n${timestamp(startMs, ",")} --> ${timestamp(Math.max(startMs + 1, endMs), ",")}\n${text}`];
  }).join("\n\n") + (metadata.segments.some((segment) => cueText(segment)) ? "\n" : "");
}

export function toVtt(metadata: SynchronizationMetadata): string {
  const cues = metadata.segments.flatMap((segment) => {
    const text = cueText(segment);
    if (!text) return [];
    const startMs = Math.floor(rationalTimeToSeconds(segment.start) * 1000);
    const endMs = Math.ceil(rationalTimeToSeconds(segment.end) * 1000);
    return [`${timestamp(startMs, ".")} --> ${timestamp(Math.max(startMs + 1, endMs), ".")}\n${text}`];
  });
  return `WEBVTT\n\n${cues.join("\n\n")}${cues.length ? "\n" : ""}`;
}
