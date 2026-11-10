import type { LocalTtsProvider, TtsAudioResult, TtsEngineStatus, TtsSynthesisRequest, TtsVoice } from "./types";
import { readWavMetadata } from "./wav";
export function normalizeLocalEndpoint(input: string): string {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error("Enter a valid local engine address, such as http://127.0.0.1:8765."); }
  const host = url.hostname.toLowerCase();
  const loopback = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  if (!loopback || !["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("For privacy, GridSplit only connects to a local TTS service on this device.");
  }
  url.pathname = url.pathname.replace(/\/+$/, ""); url.search = ""; url.hash = "";
  return url.toString().replace(/\/$/, "");
}
async function errorMessage(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  if (body) {
    try { const parsed = JSON.parse(body) as { detail?: unknown; error?: unknown };
      if (typeof parsed.detail === "string") return parsed.detail;
      if (typeof parsed.error === "string") return parsed.error;
    } catch { return body.slice(0, 240); }
  }
  return `Local TTS request failed (${response.status}).`;
}
/** Local adapter for the optional loopback-only Kokoro ONNX sidecar. */
export class KokoroLocalProvider implements LocalTtsProvider {
  readonly id = "kokoro-local"; readonly label = "Kokoro ONNX · local";
  private readonly endpoint: string;
  constructor(endpoint: string) { this.endpoint = normalizeLocalEndpoint(endpoint); }
  async check(): Promise<TtsEngineStatus> {
    const response = await fetch(`${this.endpoint}/health`, { cache: "no-store" });
    if (!response.ok) throw new Error(await errorMessage(response));
    const value = await response.json() as TtsEngineStatus;
    return { ready: value.ready === true, engine: typeof value.engine === "string" ? value.engine : "Kokoro ONNX",
      model: typeof value.model === "string" ? value.model : undefined,
      message: typeof value.message === "string" ? value.message : undefined };
  }
  async listVoices(): Promise<TtsVoice[]> {
    const response = await fetch(`${this.endpoint}/voices`, { cache: "no-store" });
    if (!response.ok) throw new Error(await errorMessage(response));
    const value = await response.json() as { voices?: unknown };
    if (!Array.isArray(value.voices)) throw new Error("The local engine returned an invalid voice catalog.");
    return value.voices.filter((voice): voice is TtsVoice => typeof voice === "object" && voice !== null
      && typeof (voice as TtsVoice).id === "string" && typeof (voice as TtsVoice).name === "string"
      && typeof (voice as TtsVoice).language === "string" && typeof (voice as TtsVoice).languageName === "string");
  }
  async synthesize(request: TtsSynthesisRequest): Promise<TtsAudioResult> {
    const text = request.text.trim();
    if (!text) throw new Error("There is no text to generate.");
    if (text.length > 5000) throw new Error("Split this segment into shorter blocks (maximum 5,000 characters).");
    if (!request.voiceId.trim()) throw new Error("Assign a voice before generating this segment.");
    const response = await fetch(`${this.endpoint}/synthesize`, { method: "POST",
      headers: { "Content-Type": "application/json" }, signal: request.signal,
      body: JSON.stringify({ text, voice_id: request.voiceId, language: request.language, speed: Math.min(2, Math.max(0.5, request.speed)) }) });
    if (!response.ok) throw new Error(await errorMessage(response));
    const blob = await response.blob();
    if (!blob.size) throw new Error("The local TTS engine returned an empty audio file.");
    const metadata = readWavMetadata(await blob.arrayBuffer());
    return { blob: new Blob([blob], { type: "audio/wav" }), sampleCount: metadata.sampleCount,
      sampleRate: metadata.sampleRate, channels: metadata.channels,
      durationSeconds: metadata.sampleCount / metadata.sampleRate, format: "wav" };
  }
}
