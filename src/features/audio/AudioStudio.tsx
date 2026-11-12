import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Download, Mic, RefreshCw, RotateCcw, Server, ShieldCheck, Sparkles, Square, Volume2, XCircle } from "lucide-react";
import type { StudioProject } from "../../lib/projectStore";
import { ensureSpeakerCharacters, reconcileAudioSegments, updateAudioSegment } from "../../lib/audioWorkflow";
import { deleteGeneratedAudio, readGeneratedAudio, saveGeneratedAudio } from "../../audio/audioStore";
import { saveProjectMedia } from "../../lib/projectMediaStore";
import { normalizeAudioMixTracks, type MixAudioAsset } from "../../domain/production";
import { DEFAULT_TTS_ENDPOINT, type StudioAudioSegment, type StudioCharacter, type TtsVoice } from "../../audio/types";
import { isCloudflareQuickTunnelEndpoint, KokoroLocalProvider } from "../../audio/kokoroProvider";
import "./audio-studio.css";

type Props = { project: StudioProject; onUpdate: (patch: Partial<StudioProject>) => void };
const DEFAULT_VOICES: TtsVoice[] = [
  { id: "af_heart", name: "Heart", language: "en-us", languageName: "American English" },
  { id: "af_bella", name: "Bella", language: "en-us", languageName: "American English" },
  { id: "af_sarah", name: "Sarah", language: "en-us", languageName: "American English" },
  { id: "af_nicole", name: "Nicole", language: "en-us", languageName: "American English" },
  { id: "am_michael", name: "Michael", language: "en-us", languageName: "American English" },
  { id: "am_adam", name: "Adam", language: "en-us", languageName: "American English" },
  { id: "bf_emma", name: "Emma", language: "en-gb", languageName: "British English" },
  { id: "bm_george", name: "George", language: "en-gb", languageName: "British English" },
  { id: "hf_alpha", name: "Alpha", language: "hi", languageName: "Hindi" },
  { id: "hf_beta", name: "Beta", language: "hi", languageName: "Hindi" },
  { id: "hm_omega", name: "Omega", language: "hi", languageName: "Hindi" },
  { id: "hm_psi", name: "Psi", language: "hi", languageName: "Hindi" },
];
const formatDuration = (seconds?: number) => seconds === undefined || !Number.isFinite(seconds)
  ? "—" : `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
function blockForSegment(project: StudioProject, segment: StudioAudioSegment) {
  const scene = project.scenes.find((item) => item.id === segment.sceneId);
  return { scene, block: scene?.blocks.find((item) => item.id === segment.blockId) };
}

export default function AudioStudio({ project, onUpdate }: Props) {
  const [endpointDraft, setEndpointDraft] = useState(project.ttsEndpoint ?? DEFAULT_TTS_ENDPOINT);
  const [engineMessage, setEngineMessage] = useState("Engine not checked yet.");
  const [engineReady, setEngineReady] = useState(false);
  const [voices, setVoices] = useState<TtsVoice[]>(DEFAULT_VOICES);
  const [newCharacter, setNewCharacter] = useState("");
  const [notice, setNotice] = useState("");
  const [activeGeneration, setActiveGeneration] = useState<string | null>(null);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const [activeCueId, setActiveCueId] = useState<string | null>(null);
  const [cueErrors, setCueErrors] = useState<Record<string, string>>({});
  const [musicReady, setMusicReady] = useState(false);
  const [sfxReady, setSfxReady] = useState(false);
  const batchCancelledRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const provider = useMemo(() => {
    try { return new KokoroLocalProvider(endpointDraft); } catch { return null; }
  }, [endpointDraft]);
  const remoteGpu = Boolean(provider && isCloudflareQuickTunnelEndpoint(endpointDraft));
  const characters = project.characters ?? [];
  const segments = project.audioSegments ?? [];
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;

  useEffect(() => setEndpointDraft(project.ttsEndpoint ?? DEFAULT_TTS_ENDPOINT), [project.ttsEndpoint]);

  useEffect(() => {
    const nextCharacters = ensureSpeakerCharacters(project.scenes, characters);
    const nextSegments = reconcileAudioSegments(project.scenes, nextCharacters, segments);
    const changed = JSON.stringify(nextCharacters) !== JSON.stringify(characters)
      || JSON.stringify(nextSegments) !== JSON.stringify(segments);
    if (changed) {
      const nextById = new Map(nextSegments.map((segment) => [segment.id, segment]));
      for (const old of segments) {
        const next = nextById.get(old.id);
        if (old.status === "ready" && (!next || next.status !== "ready" || next.fingerprint !== old.fingerprint)) {
          void deleteGeneratedAudio(project.id, old.id).catch(() => undefined);
        }
      }
      onUpdate({ characters: nextCharacters, audioSegments: nextSegments });
    }
  }, [project.id, project.scenes, project.characters, project.audioSegments, onUpdate]);

  useEffect(() => {
    let active = true;
    const created: string[] = [];
    const missing: StudioAudioSegment[] = [];
    const readySegments = segments.filter((segment) => segment.status === "ready");
    void Promise.all(readySegments.map(async (segment) => {
      try {
        const blob = await readGeneratedAudio(project.id, segment.id);
        if (!active) return null;
        if (!blob) { missing.push(segment); return null; }
        const url = URL.createObjectURL(blob);
        created.push(url);
        return [segment.id, url] as const;
      } catch { return null; }
    })).then((entries) => {
      if (!active) return;
      setPreviewUrls(Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry !== null)));
      if (missing.length) {
        const missingIds = new Set(missing.map((segment) => segment.id));
        const repaired = segments.map((segment) => missingIds.has(segment.id)
          ? { ...segment, status: "pending" as const, sampleCount: undefined, sampleRate: undefined,
              channels: undefined, durationSeconds: undefined, error: "The saved WAV file is missing. Generate this segment again." }
          : segment);
        onUpdateRef.current({ audioSegments: repaired });
      }
    });
    return () => { active = false; created.forEach((url) => URL.revokeObjectURL(url)); };
  }, [project.id, project.audioSegments]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const saveCharacters = (next: StudioCharacter[]) => onUpdate({ characters: next });
  const updateOneCharacter = (id: string, patch: Partial<StudioCharacter>) => {
    saveCharacters(characters.map((character) => character.id === id ? { ...character, ...patch, id } : character));
  };
  const renameCharacter = (character: StudioCharacter, name: string) => {
    updateOneCharacter(character.id, { name });
    const nextName = name.trim();
    if (nextName && nextName !== character.name) {
      onUpdate({ scenes: project.scenes.map((scene) => ({
        ...scene, blocks: scene.blocks.map((block) => block.kind === "dialogue" && (block.speaker ?? "") === character.name
          ? { ...block, speaker: nextName } : block),
      })) });
    }
  };
  const updateSegment = (id: string, patch: Partial<StudioAudioSegment>) => {
    const next = updateAudioSegment(segmentsRef.current, id, patch);
    segmentsRef.current = next;
    onUpdateRef.current({ audioSegments: next });
  };

  const checkEngine = async () => {
    if (!provider) { setEngineReady(false); setEngineMessage("Enter a loopback URL such as http://127.0.0.1:8765 or an HTTPS Cloudflare Quick Tunnel URL."); return; }
    setEngineMessage("Checking the Kokoro engine…"); setEngineReady(false);
    try {
      const status = await provider.check();
      if (!status.ready) { setEngineMessage(status.message || "The TTS engine is reachable but its model files are not ready."); return; }
      const available = await provider.listVoices();
      setVoices(available);
      let music = false, sfx = false;
      try {
        const response = await fetch(`${endpointDraft.replace(/\\/+$/, "")}/capabilities`, { cache: "no-store", headers: remoteGpu ? { "cf-skip-browser-warning": "true" } : undefined });
        if (response.ok) {
          const caps = await response.json() as { music?: { ready?: boolean }; sfx?: { ready?: boolean } };
          music = caps.music?.ready === true; sfx = caps.sfx?.ready === true;
        }
      } catch { /* Older TTS-only sidecars remain usable for speech. */ }
      setMusicReady(music); setSfxReady(sfx); setEngineReady(true);
      setEngineMessage(`${status.engine}${status.model ? ` · ${status.model}` : ""} is ready · ${available.length} voices · ${music ? "MusicGen ready" : "music unavailable"} · ${sfx ? "SFX ready" : "SFX unavailable"}.`);
    } catch (error) { setEngineMessage(error instanceof Error ? error.message : "Could not connect to the TTS engine."); }
  };

  const generate = async (segment: StudioAudioSegment): Promise<"success" | "failed" | "cancelled"> => {
    if (!provider) { setNotice("Enter a valid loopback or HTTPS Cloudflare Quick Tunnel address first."); return "failed"; }
    const { block } = blockForSegment(project, segment);
    if (!block?.text.trim()) { setNotice("This speech segment has no text."); return "failed"; }
    setActiveGeneration(segment.id);
    const controller = new AbortController();
    controllerRef.current = controller;
    updateSegment(segment.id, { status: "generating", error: undefined });
    try {
      const result = await provider.synthesize({ text: block.text, voiceId: segment.voiceId,
        language: segment.language, speed: segment.speed, signal: controller.signal });
      await saveGeneratedAudio(project.id, segment.id, result.blob);
      updateSegment(segment.id, { status: "ready", sampleCount: result.sampleCount, sampleRate: result.sampleRate,
        channels: result.channels, durationSeconds: result.durationSeconds, error: undefined });
      return "success";
    } catch (error) {
      const cancelled = controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
      updateSegment(segment.id, { status: cancelled ? "pending" : "failed",
        error: cancelled ? undefined : error instanceof Error ? error.message : "Audio generation failed." });
      if (!cancelled) setNotice(error instanceof Error ? error.message : "Audio generation failed.");
      return cancelled ? "cancelled" : "failed";
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      setActiveGeneration(null);
    }
  };

  const generateAllRemaining = async () => {
    if (!provider || !engineReady) {
      setNotice("Connect to the Kokoro engine before starting batch generation.");
      return;
    }
    const queue = sortedSegments
      .filter(({ segment, block }) => segment.status !== "ready" && segment.status !== "generating" && Boolean(block?.text.trim()))
      .map(({ segment }) => segment);
    if (!queue.length) {
      setNotice("All narration and dialogue audio is already generated.");
      return;
    }

    batchCancelledRef.current = false;
    setBatchRunning(true);
    setBatchProgress({ current: 0, total: queue.length });
    let generated = 0;
    let failed = 0;
    let completed = 0;
    for (const segment of queue) {
      if (batchCancelledRef.current) break;
      const result = await generate(segment);
      if (result === "success") generated += 1;
      if (result === "failed") failed += 1;
      completed += 1;
      setBatchProgress({ current: completed, total: queue.length });
      if (result === "cancelled") break;
    }
    const cancelled = batchCancelledRef.current;
    setBatchRunning(false);
    setNotice(cancelled
      ? `Batch stopped. Generated ${generated} of ${queue.length} queued segment(s); successful audio was kept.`
      : `Batch complete. Generated ${generated} segment(s)${failed ? `; ${failed} failed — retry those individually or run the batch again.` : "."}`);
  };

  const cancelBatch = () => {
    batchCancelledRef.current = true;
    controllerRef.current?.abort();
  };
  const downloadAudio = (segment: StudioAudioSegment) => {
    const url = previewUrls[segment.id]; if (!url) return;
    const link = document.createElement("a"); link.href = url;
    link.download = `${segment.id.replace(/[^a-z0-9_-]/gi, "-")}.wav`; link.click();
  };
  const removeUnusedCharacter = (character: StudioCharacter) => {
    const used = project.scenes.some((scene) => scene.blocks.some((block) =>
      block.kind === "dialogue" && (block.speaker ?? "").trim().toLowerCase() === character.name.trim().toLowerCase()));
    if (used) { setNotice("This character is still used by a dialogue block. Remove or rename those blocks first."); return; }
    saveCharacters(characters.filter((item) => item.id !== character.id));
  };
  const addCharacter = () => {
    const name = newCharacter.trim(); if (!name) return;
    if (characters.some((character) => character.name.trim().toLowerCase() === name.toLowerCase())) {
      setNotice("A character with that name already exists."); return;
    }
    saveCharacters([...characters, { id: crypto.randomUUID(), name, voiceId: voices[0]?.id ?? "af_heart",
      language: voices[0]?.language ?? "en-us", speed: 1 }]);
    setNewCharacter("");
  };

  const productionCues = project.scenes.flatMap((scene) => scene.blocks
    .filter((block) => block.kind === "music" || block.kind === "sfx")
    .map((block) => ({ scene, block, kind: block.kind as "music" | "sfx" })));
  const mixAssets = (project.mixAssets ?? []) as MixAudioAsset[];

  const generateProductionCue = async (scene: StudioProject["scenes"][number], block: StudioProject["scenes"][number]["blocks"][number], kind: "music" | "sfx") => {
    const cueId = `cue:${scene.id}:${block.id}`;
    if (!provider || !engineReady) { setNotice("Connect the Colab audio engine before generating music or SFX."); return; }
    if (kind === "music" && !musicReady) { setNotice("This Colab runtime does not advertise /generate-music. Restart it with the full audio-generation notebook."); return; }
    if (kind === "sfx" && !sfxReady) { setNotice("This Colab runtime does not advertise /generate-sfx. Restart it with the full audio-generation notebook."); return; }
    const prompt = [block.cue, block.text].filter(Boolean).join(": ").trim();
    if (!prompt) { setNotice("Add a descriptive prompt to this music or SFX cue first."); return; }
    setActiveCueId(cueId);
    setCueErrors((current) => ({ ...current, [cueId]: "" }));
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const base = endpointDraft.replace(/\\/+$/, "");
      const response = await fetch(`${base}/generate-${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(remoteGpu ? { "cf-skip-browser-warning": "true" } : {}) },
        body: JSON.stringify({ prompt, duration_seconds: kind === "music" ? 20 : 6, ...(kind === "music" ? { steps: 30 } : { steps: 60 }) }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(body.slice(0, 400) || `${kind.toUpperCase()} generation failed (${response.status}).`);
      }
      const raw = await response.blob();
      if (!raw.size) throw new Error("The audio model returned an empty WAV file.");
      const blob = new Blob([raw], { type: "audio/wav" });
      const context = new AudioContext();
      let duration: number;
      try { duration = (await context.decodeAudioData(await blob.arrayBuffer())).duration; }
      finally { await context.close(); }
      const tracks = normalizeAudioMixTracks(project.audioMixTracks, () => crypto.randomUUID());
      const targetTrack = tracks.find((track) => track.kind === kind);
      if (!targetTrack) throw new Error(`The ${kind} mixer track is unavailable.`);
      const existing = mixAssets.find((asset) => asset.sourceBlockId === block.id && asset.sourceSceneId === scene.id && asset.kind === kind);
      const id = existing?.id ?? crypto.randomUUID();
      await saveProjectMedia(project.id, id, blob);
      const nextAsset: MixAudioAsset = {
        id, name: `${kind}-${scene.title.replace(/[^a-z0-9_-]+/gi, "-")}-${block.id}.wav`,
        mimeType: "audio/wav", bytes: blob.size, kind, trackId: targetTrack.id,
        ...(kind === "sfx" ? { sceneId: scene.id } : {}),
        sourceBlockId: block.id, sourceSceneId: scene.id,
        startSeconds: existing?.startSeconds ?? 0, durationSeconds: duration,
        order: existing?.order ?? mixAssets.length,
      };
      const nextAssets = existing
        ? mixAssets.map((asset) => asset.id === id ? nextAsset : asset)
        : [...mixAssets, nextAsset];
      onUpdate({
        audioMixTracks: tracks,
        mixAssets: nextAssets,
      } as Partial<StudioProject>);
      setNotice(`${kind === "music" ? "Music" : "Sound effect"} generated and added to the ${kind} mixer track.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : `${kind} generation failed.`;
      setCueErrors((current) => ({ ...current, [cueId]: message }));
      setNotice(message);
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      setActiveCueId(null);
    }
  };

  const sortedSegments = segments.map((segment) => ({ segment, ...blockForSegment(project, segment) })).filter((item) => item.block);

  return <section className="audio-studio-view">
    <div className="audio-studio-heading"><div><div className="studio-eyebrow"><Mic size={13}/> M12 · M13 · M14 · M15 · M16</div>
      <h1>Voices & <em>audio.</em></h1><p>Assign a consistent voice to each character, generate speech with local Kokoro or an explicitly selected temporary GPU endpoint, and review every segment.</p></div>
      <div className="audio-local-pill"><ShieldCheck size={15}/> {remoteGpu ? "Temporary remote GPU" : "Local generation · no cloud fallback"}</div></div>
    {notice && <div className="audio-notice" role="status">{notice}<button onClick={() => setNotice("")}>Dismiss</button></div>}

    <section className="audio-panel">
      <div className="audio-panel-title"><div><span className="audio-step">M12</span><div><h2>Characters & voice assignments</h2><p>Speaker identities are saved per project and keep their voice across scenes.</p></div></div><span className="audio-count">{characters.length} characters</span></div>
      <div className="audio-character-list">
        {characters.map((character) => {
          const options = voices.length ? voices : DEFAULT_VOICES;
          const selected = options.find((voice) => voice.id === character.voiceId);
          return <article className="audio-character" key={character.id}>
            <div className="audio-character-name"><span className="audio-avatar">{character.narrator ? "N" : character.name.slice(0, 1).toUpperCase()}</span>
              <div>{character.narrator ? <b>Narrator</b> : <input aria-label="Character name" value={character.name}
                onChange={(event) => renameCharacter(character, event.target.value)} />}
                <small>{character.narrator ? "Narration voice" : "Dialogue character"}</small></div></div>
            <label>Voice<select value={character.voiceId} onChange={(event) => {
              const voice = options.find((item) => item.id === event.target.value);
              updateOneCharacter(character.id, { voiceId: event.target.value, language: voice?.language ?? character.language });
            }}>
              {!selected && <option value={character.voiceId}>{character.voiceId}</option>}
              {options.map((voice) => <option key={voice.id} value={voice.id}>{voice.name} · {voice.languageName}</option>)}
            </select></label>
            <label>Speed <span>{character.speed.toFixed(1)}×</span><input type="range" min="0.7" max="1.3" step="0.1"
              value={character.speed} onChange={(event) => updateOneCharacter(character.id, { speed: Number(event.target.value) })}/></label>
            {!character.narrator && <button className="audio-icon-button" title="Remove unused character" onClick={() => removeUnusedCharacter(character)}><XCircle size={16}/></button>}
          </article>;
        })}
        {!characters.length && <div className="audio-empty">Parse a script containing [NARRATOR] or [CHARACTER: NAME] blocks to create voice assignments.</div>}
      </div>
      <div className="audio-add-character"><input value={newCharacter} onChange={(event) => setNewCharacter(event.target.value)}
        placeholder="Add a character name" onKeyDown={(event) => { if (event.key === "Enter") addCharacter(); }}/>
        <button onClick={addCharacter}><Mic size={14}/> Add character</button></div>
    </section>

    <section className="audio-panel">
      <div className="audio-panel-title"><div><span className="audio-step">M13–M14</span><div><h2>Kokoro engine</h2><p>Use the local sidecar or an explicitly configured HTTPS Cloudflare Quick Tunnel for a temporary Colab GPU.</p></div></div>
        <span className={engineReady ? "audio-engine-state ready" : "audio-engine-state"}>{engineReady ? <CheckCircle2 size={13}/> : <Server size={13}/>} {engineReady ? "Ready" : "Not connected"}</span></div>
      <div className="audio-engine-config"><label>Engine address<input value={endpointDraft} onChange={(event) => { setEndpointDraft(event.target.value); setEngineReady(false); setEngineMessage("Test the updated engine address before generating."); }} spellCheck={false}/></label>
        <button className="audio-primary-button" onClick={() => { onUpdate({ ttsEndpoint: endpointDraft }); void checkEngine(); }}><RefreshCw size={14}/> Test connection</button></div>
      <p className="audio-engine-message"><ShieldCheck size={14}/>{engineMessage}</p>
      {remoteGpu && <p className="audio-remote-warning" role="note">Temporary remote GPU mode: narration and dialogue text are sent over HTTPS to the configured Colab runtime. Generated WAV files and project data remain in this browser. The Quick Tunnel is unauthenticated while active, so stop its tunnel and Colab runtime when you finish.</p>}
      <div className="audio-engine-help"><b>First-time setup</b><span>For local generation, install the optional sidecar and model/voice files yourself. No weights are bundled. Run these commands from the repository root's local-tts folder.</span>
        <code>cd local-tts && uv sync --locked --no-dev</code><code>uv run --no-sync uvicorn server:app --host 127.0.0.1 --port 8765</code>
        <span>For the deployed site, allow its exact browser origin before starting the local sidecar. Windows PowerShell: <code>$env:GRIDSPLIT_ALLOWED_ORIGINS="https://gridsplit-studio.vercel.app"</code>. macOS/Linux: prefix the server command with <code>GRIDSPLIT_ALLOWED_ORIGINS=https://gridsplit-studio.vercel.app</code>.</span>
        <b>Temporary Colab GPU</b><span>Start the CUDA Kokoro API, its CORS-enabled browser API on port 8001, then run <code>cloudflared tunnel --url http://127.0.0.1:8001</code>. Paste the generated HTTPS <code>*.trycloudflare.com</code> URL above and keep all three Colab cells running. Text is sent to Colab only when this remote endpoint is selected.</span>
        <a href="https://github.com/somildholakia/GridSplit/tree/main/local-tts" target="_blank" rel="noreferrer">Local setup guide in the repository</a></div>
    </section>

    <section className="audio-panel">
      <div className="audio-panel-title"><div><span className="audio-step">M15–M16</span><div><h2>Generated segments</h2><p>Generate narration and dialogue one by one, and generate music/SFX cues separately.</p></div></div>
        <div className="audio-batch-controls"><span className="audio-count">{segments.filter((item) => item.status === "ready").length} / {segments.length} ready</span>
          {batchRunning
            ? <button className="audio-secondary-button" onClick={cancelBatch}><Square size={13}/> Stop batch</button>
            : <button className="audio-primary-button" disabled={!engineReady || activeGeneration !== null || !sortedSegments.some(({ segment, block }) => segment.status !== "ready" && segment.status !== "generating" && Boolean(block?.text.trim()))} onClick={() => void generateAllRemaining()}><Sparkles size={13}/> Generate all remaining</button>}
        </div></div>
      {batchRunning && <div className="audio-batch-progress" role="status"><div><span>Generating audio sequentially</span><b>{batchProgress.current} / {batchProgress.total}</b></div><progress max={Math.max(1, batchProgress.total)} value={batchProgress.current}/><small>Existing completed audio is skipped. Failed segments do not stop the remaining queue.</small></div>}
      <p className="audio-cue-note">Narration and dialogue use Kokoro. Music and SFX cues below use the separate MusicGen and AudioLDM 2 endpoints and are saved directly to the project mixer.</p>
      <div className="audio-segment-list">
        {productionCues.map(({ scene, block, kind }) => {
          const cueId = `cue:${scene.id}:${block.id}`;
          const asset = mixAssets.find((item) => item.sourceBlockId === block.id && item.sourceSceneId === scene.id && item.kind === kind);
          const busy = activeCueId === cueId;
          const ready = Boolean(asset);
          const available = kind === "music" ? musicReady : sfxReady;
          return <article className="audio-segment" key={cueId}>
            <div className="audio-segment-top"><div><span>{scene.title}</span><b>{kind === "music" ? "Background music" : "Sound effect"}</b></div>
              <span className={`audio-status ${busy ? "generating" : ready ? "ready" : "pending"}`}>{busy ? "generating" : ready ? "ready · in mixer" : "pending"}</span></div>
            <p className="audio-segment-text">{[block.cue, block.text].filter(Boolean).join(": ")}</p>
            {cueErrors[cueId] && <p className="audio-segment-error"><AlertCircle size={13}/>{cueErrors[cueId]}</p>}
            <div className="audio-segment-actions">
              <button className={ready ? "audio-secondary-button" : "audio-primary-button"} disabled={!engineReady || !available || activeCueId !== null || activeGeneration !== null || batchRunning || busy}
                onClick={() => void generateProductionCue(scene, block, kind)}>{busy ? <><RefreshCw size={13}/> Generating…</> : ready ? <><RotateCcw size={13}/> Regenerate</> : <><Sparkles size={13}/> Generate {kind === "music" ? "music" : "SFX"}</>}</button>
              {ready && <span className="audio-generated-note"><CheckCircle2 size={13}/> Saved to {kind} mixer</span>}
              {!available && <span className="audio-disabled-note">{engineReady ? `Colab ${kind === "music" ? "MusicGen" : "AudioLDM 2"} endpoint unavailable.` : "Connect the audio engine first."}</span>}
            </div>
          </article>;
        })}
        {!productionCues.length && <div className="audio-empty">No music or SFX cues found. Add [MUSIC: ...] or [SFX: ...] blocks in Script studio.</div>}
      </div>
      <div className="audio-segment-list">
        {sortedSegments.map(({ segment, scene, block }) => {
          const ready = segment.status === "ready", busy = activeGeneration === segment.id;
          const speaker = block?.kind === "dialogue" ? block.speaker ?? "Unknown speaker" : "Narrator";
          return <article className="audio-segment" key={segment.id}>
            <div className="audio-segment-top"><div><span>{scene?.title ?? "Scene"}</span><b>{speaker}</b></div>
              <span className={`audio-status ${segment.status}`}>{segment.status === "ready" ? <CheckCircle2 size={12}/> :
                segment.status === "failed" ? <AlertCircle size={12}/> : segment.status === "generating" ? <RefreshCw size={12}/> : <Volume2 size={12}/>} {segment.status}</span></div>
            <p className="audio-segment-text">{block?.text}</p>
            {segment.error && <p className="audio-segment-error"><AlertCircle size={13}/>{segment.error}</p>}
            {ready && <div className="audio-player-row">{previewUrls[segment.id]
              ? <audio controls preload="none" src={previewUrls[segment.id]}>Audio playback is not supported by this browser.</audio>
              : <span className="audio-loading-preview">Loading locally saved preview…</span>}
              <span>{formatDuration(segment.durationSeconds)} · {segment.sampleRate?.toLocaleString()} Hz</span>
              <button className="audio-icon-button" title="Download WAV" disabled={!previewUrls[segment.id]} onClick={() => downloadAudio(segment)}><Download size={15}/></button>
            </div>}
            <div className="audio-segment-actions">
              {busy ? <button className="audio-secondary-button" onClick={() => controllerRef.current?.abort()}><Square size={13}/> Cancel</button>
                : <button className={ready ? "audio-secondary-button" : "audio-primary-button"} disabled={!engineReady || activeGeneration !== null || batchRunning}
                  onClick={() => void generate(segment)}>{ready ? <><RotateCcw size={13}/> Regenerate</> : segment.status === "failed"
                    ? <><RefreshCw size={13}/> Retry</> : <><Sparkles size={13}/> Generate audio</>}</button>}
              {ready && <span className="audio-generated-note"><CheckCircle2 size={13}/> Saved in this browser</span>}
              {segment.status !== "ready" && !engineReady && <span className="audio-disabled-note">Connect the TTS engine to generate.</span>}
            </div>
          </article>;
        })}
        {!sortedSegments.length && <div className="audio-empty">No narration or dialogue blocks yet. Add them in Script studio and return here.</div>}
      </div>
    </section>
    <p className="audio-footnote"><ShieldCheck size={14}/> {remoteGpu ? "In temporary GPU mode, narration/dialogue text is sent to the configured Colab endpoint over HTTPS. Generated WAV files and voice assignments remain in this browser." : "Text, generated WAV files, and voice assignments remain on this device."} Audio blobs are stored separately in IndexedDB; the project JSON keeps only small metadata.</p>
  </section>;
}
