import type { AudioApiCapabilities, LocalTtsProvider, TtsAudioResult, TtsEngineStatus, TtsSynthesisRequest, TtsVoice } from "./types";
import { readWavMetadata } from "./wav";

export function isCloudflareQuickTunnelEndpoint(input: string): boolean {
  try {
    const url = new URL(input.trim());
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && host.endsWith(".trycloudflare.com")
      && host.length > ".trycloudflare.com".length && !url.username && !url.password;
  } catch { return false; }
}

export function normalizeLocalEndpoint(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("Enter a loopback URL such as http://127.0.0.1:8765 or an HTTPS Cloudflare Quick Tunnel URL.");
  }
  const host = url.hostname.toLowerCase();
  const loopback = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  const quickTunnel = url.protocol === "https:" && host.endsWith(".trycloudflare.com")
    && host.length > ".trycloudflare.com".length;
  if ((!loopback && !quickTunnel) || !["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("For privacy, GridSplit accepts loopback TTS services or explicitly entered HTTPS Cloudflare Quick Tunnels only.");
  }
  url.pathname = url.pathname.replace(/\/+$/, ""); url.search = ""; url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export type AudioApiRequestOptions = {
  method?: "GET" | "POST";
  payload?: unknown;
  signal?: AbortSignal;
};

/**
 * Send remote Quick Tunnel requests through GridSplit's same-origin Vercel function.
 * Cloudflare's bypass header is added server-side so the browser never sends a
 * custom cross-origin header that would trigger a blocked OPTIONS preflight.
 * Local loopback requests continue to go directly to the local sidecar.
 */
export async function requestAudioApi(
  inputEndpoint: string,
  path: "health" | "voices" | "capabilities" | "synthesize" | "generate-music" | "generate-sfx",
  options: AudioApiRequestOptions = {},
): Promise<Response> {
  const endpoint = normalizeLocalEndpoint(inputEndpoint);
  const method = options.method ?? "GET";
  const isRemote = isCloudflareQuickTunnelEndpoint(endpoint);

  if (isRemote) {
    if (method === "GET") {
      const query = new URLSearchParams({ endpoint, path });
      return fetch(`/api/audio-proxy?${query.toString()}`, {
        method: "GET",
        cache: "no-store",
        signal: options.signal,
      });
    }
    return fetch("/api/audio-proxy", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint, path, payload: options.payload ?? {} }),
      signal: options.signal,
    });
  }

  const url = `${endpoint}/${path}`;
  const init: RequestInit = {
    method,
    cache: "no-store",
    signal: options.signal,
  };
  if (method === "POST") {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(options.payload ?? {});
  }
  return fetch(url, init);
}

async function errorMessage(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  if (body) {
    try {
      const parsed = JSON.parse(body) as { detail?: unknown; error?: unknown };
      if (typeof parsed.detail === "string") return parsed.detail;
      if (typeof parsed.error === "string") return parsed.error;
    } catch {
      return body.slice(0, 240);
    }
  }
  return `TTS request failed (${response.status}).`;
}

/** Kokoro adapter for loopback sidecars and explicitly selected HTTPS Cloudflare Quick Tunnels. */
export class KokoroLocalProvider implements LocalTtsProvider {
  readonly id = "kokoro-local";
  readonly label: string;
  private readonly endpoint: string;

  constructor(endpoint: string) {
    this.endpoint = normalizeLocalEndpoint(endpoint);
    this.label = isCloudflareQuickTunnelEndpoint(this.endpoint)
      ? "Kokoro ONNX · temporary GPU" : "Kokoro ONNX · local";
  }

  async check(): Promise<TtsEngineStatus> {
    const response = await requestAudioApi(this.endpoint, "health", { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(await errorMessage(response));
    const value = await response.json() as TtsEngineStatus;
    return {
      ready: value.ready === true,
      engine: typeof value.engine === "string" ? value.engine : "Kokoro ONNX",
      model: typeof value.model === "string" ? value.model : undefined,
      message: typeof value.message === "string" ? value.message : undefined,
    };
  }

  async listVoices(): Promise<TtsVoice[]> {
    const response = await requestAudioApi(this.endpoint, "voices", { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(await errorMessage(response));
    const value = await response.json() as { voices?: unknown };
    if (!Array.isArray(value.voices)) throw new Error("The TTS engine returned an invalid voice catalog.");
    return value.voices.flatMap((voice): TtsVoice[] => {
      if (typeof voice === "string" && voice.trim()) {
        const id = voice.trim();
        const prefix = id.split("_", 1)[0];
        const language = prefix === "bf" || prefix === "bm" ? "en-gb"
          : prefix === "hf" || prefix === "hm" ? "hi" : "en-us";
        const languageName = language === "en-gb" ? "British English"
          : language === "hi" ? "Hindi" : "American English";
        const name = id.split("_").slice(1).join(" ").replace(/\b\w/g, (letter) => letter.toUpperCase()) || id;
        return [{ id, name, language, languageName }];
      }
      if (typeof voice !== "object" || voice === null) return [];
      const item = voice as TtsVoice;
      return typeof item.id === "string" && typeof item.name === "string"
        && typeof item.language === "string" && typeof item.languageName === "string" ? [item] : [];
    });
  }

  async capabilities(): Promise<AudioApiCapabilities> {
    const response = await requestAudioApi(this.endpoint, "capabilities", { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(await errorMessage(response));
    return await response.json() as AudioApiCapabilities;
  }

  async synthesize(request: TtsSynthesisRequest): Promise<TtsAudioResult> {
    const text = request.text.trim();
    if (!text) throw new Error("There is no text to generate.");
    if (text.length > 5000) throw new Error("Split this segment into shorter blocks (maximum 5,000 characters).");
    if (!request.voiceId.trim()) throw new Error("Assign a voice before generating this segment.");
    const response = await requestAudioApi(this.endpoint, "synthesize", {
      method: "POST",
      signal: request.signal,
      payload: {
        text,
        voice_id: request.voiceId,
        language: request.language,
        speed: Math.min(2, Math.max(0.5, request.speed)),
      },
    });
    if (!response.ok) throw new Error(await errorMessage(response));
    const blob = await response.blob();
    if (!blob.size) throw new Error("The local TTS engine returned an empty audio file.");
    const metadata = readWavMetadata(await blob.arrayBuffer());
    return {
      blob: new Blob([blob], { type: "audio/wav" }),
      sampleCount: metadata.sampleCount,
      sampleRate: metadata.sampleRate,
      channels: metadata.channels,
      durationSeconds: metadata.sampleCount / metadata.sampleRate,
      format: "wav",
    };
  }
}
