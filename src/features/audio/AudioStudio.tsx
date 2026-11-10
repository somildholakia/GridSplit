import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Download, Mic, RefreshCw, RotateCcw, Server, ShieldCheck, Sparkles, Square, Volume2, XCircle } from "lucide-react";
import type { StudioProject } from "../../lib/projectStore";
import { ensureSpeakerCharacters, reconcileAudioSegments, updateAudioSegment } from "../../lib/audioWorkflow";
import { deleteGeneratedAudio, readGeneratedAudio, saveGeneratedAudio } from "../../audio/audioStore";
import { DEFAULT_TTS_ENDPOINT, type StudioAudioSegment, type StudioCharacter, type TtsVoice } from "../../audio/types";
import { KokoroLocalProvider } from "../../audio/kokoroProvider";
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
  const [engineMessage, setEngineMessage] = useState("Local engine not checked yet.");
  const [engineReady, setEngineReady] = useState(false);
  const [voices, setVoices] = useState<TtsVoice[]>(DEFAULT_VOICES);
  const [newCharacter, setNewCharacter] = useState("");
  const [notice, setNotice] = useState("");
  const [activeGeneration, setActiveGeneration] = useState<string | null>(null);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const controllerRef = useRef<AbortController | null>(null);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const provider = useMemo(() => {
    try { return new KokoroLocalProvider(endpointDraft); } catch { return null; }
  }, [endpointDraft]);
  const characters = project.characters ?? [];
  const segments = project.audioSegments ?? [];

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
    onUpdate({ audioSegments: updateAudioSegment(segments, id, patch) });
  };

  const checkEngine = async () => {
    if (!provider) { setEngineReady(false); setEngineMessage("Use a loopback address such as http://127.0.0.1:8765."); return; }
    setEngineMessage("Checking the local engine…"); setEngineReady(false);
    try {
      const status = await provider.check();
      if (!status.ready) { setEngineMessage(status.message || "The local engine is reachable but its model files are not ready."); return; }
      const available = await provider.listVoices();
      setVoices(available); setEngineReady(true);
      setEngineMessage(`${status.engine}${status.model ? ` · ${status.model}` : ""} is ready · ${available.length} voices detected.`);
    } catch (error) { setEngineMessage(error instanceof Error ? error.message : "Could not connect to the local TTS engine."); }
  };

  const generate = async (segment: StudioAudioSegment) => {
    if (!provider) { setNotice("Enter a valid loopback engine address first."); return; }
    const { block } = blockForSegment(project, segment);
    if (!block?.text.trim()) { setNotice("This segment has no speech text."); return; }
    setActiveGeneration(segment.id);
    const controller = new AbortController(); controllerRef.current = controller;
    updateSegment(segment.id, { status: "generating", error: undefined });
    try {
      const result = await provider.synthesize({ text: block.text, voiceId: segment.voiceId,
        language: segment.language, speed: segment.speed, signal: controller.signal });
      await saveGeneratedAudio(project.id, segment.id, result.blob);
      updateSegment(segment.id, { status: "ready", sampleCount: result.sampleCount, sampleRate: result.sampleRate,
        channels: result.channels, durationSeconds: result.durationSeconds, error: undefined });
      setNotice(`Generated ${formatDuration(result.durationSeconds)} of audio locally.`);
    } catch (error) {
      const cancelled = controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
      updateSegment(segment.id, { status: cancelled ? "pending" : "failed",
        error: cancelled ? undefined : error instanceof Error ? error.message : "Audio generation failed." });
      if (!cancelled) setNotice(error instanceof Error ? error.message : "Audio generation failed.");
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      setActiveGeneration(null);
    }
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
  const sortedSegments = segments.map((segment) => ({ segment, ...blockForSegment(project, segment) })).filter((item) => item.block);

  return <section className="audio-studio-view">
    <div className="audio-studio-heading"><div><div className="studio-eyebrow"><Mic size={13}/> M12 · M13 · M14 · M15 · M16</div>
      <h1>Voices & <em>audio.</em></h1><p>Assign a consistent voice to each character, generate speech locally, and review every segment.</p></div>
      <div className="audio-local-pill"><ShieldCheck size={15}/> Local generation · no cloud fallback</div></div>
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
      <div className="audio-panel-title"><div><span className="audio-step">M13–M14</span><div><h2>Offline engine</h2><p>Kokoro ONNX runs in a separate local process; the browser only talks to loopback.</p></div></div>
        <span className={engineReady ? "audio-engine-state ready" : "audio-engine-state"}>{engineReady ? <CheckCircle2 size={13}/> : <Server size={13}/>} {engineReady ? "Ready" : "Not connected"}</span></div>
      <div className="audio-engine-config"><label>Local engine address<input value={endpointDraft} onChange={(event) => { setEndpointDraft(event.target.value); setEngineReady(false); setEngineMessage("Test the updated local engine address before generating."); }} spellCheck={false}/></label>
        <button className="audio-primary-button" onClick={() => { onUpdate({ ttsEndpoint: endpointDraft }); void checkEngine(); }}><RefreshCw size={14}/> Test connection</button></div>
      <p className="audio-engine-message"><ShieldCheck size={14}/>{engineMessage}</p>
      <div className="audio-engine-help"><b>First-time setup</b><span>Install the optional local engine and download the model and voice files yourself. No weights are included in this app.</span>
        <code>cd local-tts && uv sync</code><code>uv run uvicorn server:app --host 127.0.0.1 --port 8765</code>
        <a href="https://github.com/somildholakia/GridSplit/tree/feat/m06-m11-studio-script-workflow/local-tts" target="_blank" rel="noreferrer">Setup guide in the repository</a></div>
    </section>

    <section className="audio-panel">
      <div className="audio-panel-title"><div><span className="audio-step">M15–M16</span><div><h2>Generated segments</h2><p>Generate, retry, play, and download one narration or dialogue block at a time.</p></div></div>
        <span className="audio-count">{segments.filter((item) => item.status === "ready").length} / {segments.length} ready</span></div>
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
                : <button className={ready ? "audio-secondary-button" : "audio-primary-button"} disabled={!engineReady || activeGeneration !== null}
                  onClick={() => void generate(segment)}>{ready ? <><RotateCcw size={13}/> Regenerate</> : segment.status === "failed"
                    ? <><RefreshCw size={13}/> Retry</> : <><Sparkles size={13}/> Generate audio</>}</button>}
              {ready && <span className="audio-generated-note"><CheckCircle2 size={13}/> Saved in this browser</span>}
              {segment.status !== "ready" && !engineReady && <span className="audio-disabled-note">Connect the local engine to generate.</span>}
            </div>
          </article>;
        })}
        {!sortedSegments.length && <div className="audio-empty">No narration or dialogue blocks yet. Add them in Script studio and return here.</div>}
      </div>
    </section>
    <p className="audio-footnote"><ShieldCheck size={14}/> Text, generated WAV files, and voice assignments remain on this device. Audio blobs are stored separately in IndexedDB; the project JSON keeps only small metadata.</p>
  </section>;
}
