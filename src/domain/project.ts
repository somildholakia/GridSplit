import type { RationalFrameRate, RationalTime } from "./time";

export const PROJECT_SCHEMA_VERSION = 1 as const;

export type ProjectAssetKind =
  | "script"
  | "image"
  | "contact-sheet"
  | "audio"
  | "subtitle"
  | "video"
  | "model"
  | "other";

export type AssetOrigin = "user-import" | "generated" | "model-install";

export interface ProjectAsset {
  id: string;
  kind: ProjectAssetKind;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** Relative path within a portable project archive; never an OS absolute path. */
  archivePath: string;
  origin: AssetOrigin;
  sha256?: string;
  sourceUrl?: string;
  license?: string;
}

export type ScriptBlockKind = "narration" | "dialogue" | "sfx" | "music";

export interface ScriptBlock {
  id: string;
  order: number;
  kind: ScriptBlockKind;
  text: string;
  speakerId?: string;
  cue?: string;
}

export interface ProjectChapter {
  id: string;
  title: string;
  order: number;
}

export interface ProjectScene {
  id: string;
  chapterId?: string;
  title?: string;
  order: number;
  blocks: ScriptBlock[];
}

export interface ProjectSpeaker {
  id: string;
  name: string;
  voiceProviderId?: string;
  voiceId?: string;
  voiceSettings?: Record<string, string | number | boolean>;
}

export type AudioSegmentStatus = "pending" | "generating" | "ready" | "failed";

export interface AudioSampleMetadata {
  sampleCount: number;
  sampleRate: number;
  channels: number;
  format: string;
}

export interface AudioSegment {
  id: string;
  sceneId: string;
  blockId: string;
  speakerId?: string;
  text: string;
  assetId?: string;
  status: AudioSegmentStatus;
  audio?: AudioSampleMetadata;
  providerId?: string;
  providerVersion?: string;
  modelId?: string;
  voiceId?: string;
  alignmentAssetId?: string;
}

export interface SceneImageMapping {
  id: string;
  /** A mapping may connect an asset to one or multiple scenes. */
  sceneIds: string[];
  imageAssetId: string;
  order: number;
  displayRange?: {
    start: RationalTime;
    end: RationalTime;
  };
  source: "automatic" | "user";
}

export type TrackKind = "image" | "narration" | "dialogue" | "music" | "sfx" | "subtitle";

export interface TimelineClip {
  id: string;
  assetId: string;
  start: RationalTime;
  end: RationalTime;
  sourceStart?: number;
  sourceEnd?: number;
  sourceUnit?: "sample" | "frame";
  transitionIn?: { type: string; duration: RationalTime };
  transitionOut?: { type: string; duration: RationalTime };
  effect?: { type: string; settings: Record<string, string | number | boolean> };
}

export interface ProjectTrack {
  id: string;
  kind: TrackKind;
  name: string;
  order: number;
  muted: boolean;
  solo: boolean;
  volume: number;
  clips: TimelineClip[];
}

export interface SubtitleCue {
  id: string;
  text: string;
  speakerId?: string;
  start: RationalTime;
  end: RationalTime;
  alignment?: "segment" | "phrase" | "word";
  alignmentSource?: string;
}

export interface ProjectJob {
  id: string;
  kind: "audio-generation" | "render" | "asset-import";
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  inputFingerprint?: string;
  completedStages: string[];
  errorMessage?: string;
  updatedAt: string;
}

export interface ProjectDocument {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  project: {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
  };
  settings: {
    video: {
      width: number;
      height: number;
      fps: RationalFrameRate;
    };
    preferredAudioSampleRate?: number;
  };
  sourceScript: {
    assetId?: string;
    originalText: string;
    format: "plain-text" | "txt" | "docx" | "pdf";
  };
  chapters: ProjectChapter[];
  scenes: ProjectScene[];
  speakers: ProjectSpeaker[];
  assets: ProjectAsset[];
  audioSegments: AudioSegment[];
  sceneImageMappings: SceneImageMapping[];
  tracks: ProjectTrack[];
  subtitleCues: SubtitleCue[];
  jobs: ProjectJob[];
}

export function hasSupportedProjectSchemaVersion(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return "schemaVersion" in value &&
    (value as { schemaVersion?: unknown }).schemaVersion === PROJECT_SCHEMA_VERSION;
}
