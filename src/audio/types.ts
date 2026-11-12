export type AudioSegmentStatus = "pending" | "generating" | "ready" | "failed";
export interface StudioCharacter { id: string; name: string; voiceId: string; language: string; speed: number; narrator?: boolean }
export interface StudioAudioSegment {
  id: string; sceneId: string; blockId: string; fingerprint: string; status: AudioSegmentStatus;
  providerId: string; voiceId: string; language: string; speed: number;
  sampleCount?: number; sampleRate?: number; channels?: number; durationSeconds?: number; error?: string; updatedAt: string;
}
export interface TtsVoice { id: string; name: string; language: string; languageName: string }
export interface TtsEngineStatus { ready: boolean; engine: string; model?: string; message?: string }
export interface AudioApiCapabilities {
  tts?: { ready?: boolean; endpoint?: string; engine?: string };
  music?: { ready?: boolean; endpoint?: string; model?: string; max_duration_seconds?: number };
  sfx?: { ready?: boolean; endpoint?: string; model?: string; max_duration_seconds?: number };
}
export interface TtsSynthesisRequest { text: string; voiceId: string; language: string; speed: number; signal?: AbortSignal }
export interface TtsAudioResult { blob: Blob; sampleCount: number; sampleRate: number; channels: number; durationSeconds: number; format: "wav" }
export interface LocalTtsProvider {
  readonly id: string; readonly label: string;
  check(): Promise<TtsEngineStatus>; listVoices(): Promise<TtsVoice[]>;
  synthesize(request: TtsSynthesisRequest): Promise<TtsAudioResult>;
}
export const DEFAULT_TTS_ENDPOINT = "http://127.0.0.1:8765";
export const DEFAULT_VOICE_ID = "af_heart";
export const DEFAULT_LANGUAGE = "en-us";
export const DEFAULT_SPEECH_SPEED = 1;
