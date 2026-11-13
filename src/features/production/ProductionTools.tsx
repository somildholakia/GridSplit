import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Cloud, Download, Film, Loader2, Music2, Pause, Play, Plus, RefreshCw, SlidersHorizontal, Upload, WandSparkles } from "lucide-react";
import type { StudioProject } from "../../lib/projectStore";
import {
  DEFAULT_RENDER_PROFILE,
  audibleTrackIds,
  buildGainAutomation,
  normalizeAudioMixTracks,
  type AudioMixTrack,
  type ImageEffectKind,
  type MixAudioAsset,
  type RenderProfile,
  type TransitionKind,
  type VideoClipEdit,
} from "../../domain/production";
import { readGeneratedAudio } from "../../audio/audioStore";
import { readProjectMedia, saveProjectMedia, deleteProjectMedia } from "../../lib/projectMediaStore";
import { downloadPortableProject, exportPortableProject, importPortableProject } from "../../lib/portableProject";
import { downloadRenderedVideo, getRenderReadiness, renderProjectLocally, type LocalRenderJob } from "../../lib/localRenderer";
import { buildColabNotebook, downloadMotionPackage } from "../motion-studio/colabExport";
import { checkColabRenderer, renderProjectOnColab, type ColabProgress } from "../../lib/colabRenderer";
import "./production-tools.css";

type ExtendedProject = StudioProject & {
  audioMixTracks?: AudioMixTrack[];
  mixAssets?: MixAudioAsset[];
  videoClipEdits?: VideoClipEdit[];
  renderProfile?: RenderProfile;
};
type Props = {
  project: StudioProject;
  onUpdate: (patch: Partial<StudioProject>) => void;
  onRestoreProject?: (project: StudioProject) => void;
};

const TRACK_LABELS = {
  narration: "Narration",
  dialogue: "Dialogue",
  music: "Music",
  sfx: "Sound effects",
} as const;

function formatTime(value: number): string {
  const minutes = Math.floor(value / 60);
  return minutes + ":" + (value % 60).toFixed(1).padStart(4, "0");
}

function defaultEdit(clipId: string): VideoClipEdit {
  return {
    clipId,
    effect: "none",
    transitionIn: "cut",
    transitionOut: "cut",
    transitionDurationSeconds: 0.5,
    zoom: 1.12,
  };
}

export default function ProductionTools({ project, onUpdate, onRestoreProject }: Props) {
  const data = project as ExtendedProject;
  const tracks = useMemo(
    () => normalizeAudioMixTracks(data.audioMixTracks, () => crypto.randomUUID()),
    [data.audioMixTracks],
  );
  const assets = data.mixAssets ?? [];
  const imageClips = (project.timelineClips ?? []).filter((clip) => clip.track === "images").sort((a, b) => a.order - b.order);
  const edits = data.videoClipEdits ?? [];
  const profile = data.renderProfile ?? DEFAULT_RENDER_PROFILE;
  const [tab, setTab] = useState<"mix" | "effects" | "render">("mix");
  const [selectedTrack, setSelectedTrack] = useState<"music" | "sfx">("music");
  const [endpoint, setEndpoint] = useState("http://127.0.0.1:8766");
  const [colabEndpoint, setColabEndpoint] = useState("");
  const [colabConnected, setColabConnected] = useState(false);
  const [colabChecking, setColabChecking] = useState(false);
  const [colabBusy, setColabBusy] = useState(false);
  const [colabProgress, setColabProgress] = useState<ColabProgress | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<LocalRenderJob | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const previewContext = useRef<AudioContext | null>(null);
  const previewSources = useRef<AudioBufferSourceNode[]>([]);
  const previewAbort = useRef<AbortController | null>(null);
  const colabAbort = useRef<AbortController | null>(null);

  const updateTracks = useCallback((next: AudioMixTrack[]) => onUpdate({ audioMixTracks: next } as Partial<StudioProject>), [onUpdate]);
  const updateAssets = (next: MixAudioAsset[]) => onUpdate({ mixAssets: next } as Partial<StudioProject>);
  const updateEdits = (next: VideoClipEdit[]) => onUpdate({ videoClipEdits: next } as Partial<StudioProject>);
  const updateProfile = (next: RenderProfile) => onUpdate({ renderProfile: next } as Partial<StudioProject>);
  useEffect(() => {
    if (!data.audioMixTracks || data.audioMixTracks.length < 4) updateTracks(tracks);
  }, [data.audioMixTracks, tracks, updateTracks]);
  const readyIssues = useMemo(() => getRenderReadiness(data), [data.imageAssets, data.timelineClips, data.mixAssets, data.renderProfile]);

  // Imported music starts at the programme head. Scene-bound SFX follows its
  // scene's audio clip whenever the generated speech/image schedule is rebuilt.
  const audioTimelineKey=(project.timelineClips??[])
    .filter(clip=>clip.track==="audio")
    .map(clip=>clip.sceneId+":"+clip.startSeconds+":"+clip.durationSeconds)
    .join("|");
  const mixAssetSyncKey=assets
    .map(asset=>asset.id+":"+asset.kind+":"+(asset.sceneId??"")+":"+asset.startSeconds)
    .join("|");
  useEffect(()=>{
    const sceneStarts=new Map((project.timelineClips??[])
      .filter(clip=>clip.track==="audio")
      .map(clip=>[clip.sceneId,clip.startSeconds]));
    if(!sceneStarts.size||!assets.length)return;
    let changed=false;
    const next=assets.map(asset=>{
      const start=asset.kind==="music"?0:(asset.sceneId?sceneStarts.get(asset.sceneId):undefined);
      if(start===undefined||Math.abs(asset.startSeconds-start)<0.001)return asset;
      changed=true;
      return {...asset,startSeconds:start};
    });
    if(changed)updateAssets(next);
  // The timeline key deliberately tracks only audio clip positions/durations.
  },[audioTimelineKey,mixAssetSyncKey,project.id]);


  useEffect(() => () => {
    previewSources.current.forEach((source) => { try { source.stop(); } catch { /* already ended */ } });
    void previewContext.current?.close();
    previewAbort.current?.abort();
    colabAbort.current?.abort();
  }, []);

  const updateTrack = (id: string, patch: Partial<AudioMixTrack>) => {
    updateTracks(tracks.map((track) => track.id === id ? { ...track, ...patch } : track));
  };

  const importAudio = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    let added = 0;
    const savedIds: string[] = [];
    try {
      const target = tracks.find((track) => track.kind === selectedTrack);
      if (!target) throw new Error("Choose a valid music or SFX track.");
      const context = new AudioContext();
      const nextAssets = [...assets];
      try {
        for (const file of [...files]) {
          if (!file.type.startsWith("audio/") || file.size <= 0 || file.size > 250 * 1024 * 1024) continue;
          const buffer = await context.decodeAudioData(await file.arrayBuffer());
          const id = crypto.randomUUID();
          await saveProjectMedia(project.id, id, file);
          savedIds.push(id);
          const next: MixAudioAsset = {
            id,
            name: file.name,
            mimeType: file.type || "application/octet-stream",
            bytes: file.size,
            kind: selectedTrack,
            trackId: target.id,
            sceneId: selectedTrack === "sfx" ? project.scenes[0]?.id : undefined,
            startSeconds: 0,
            durationSeconds: buffer.duration,
            order: assets.length + added,
          };
          nextAssets.push(next);
          added += 1;
        }
      } finally {
        await context.close();
      }
      updateAssets(nextAssets.sort((a, b) => a.order - b.order).map((asset, index) => ({ ...asset, order: index })));
      setNotice(added ? "Imported " + added + " local audio file(s). Set their timeline start positions below." : "No supported audio files were selected. Use a browser-decodable WAV, MP3, OGG, or M4A file under 250 MB.");
    } catch (error) {
      await Promise.all(savedIds.map((id) => deleteProjectMedia(project.id, id).catch(() => undefined)));
      setNotice(error instanceof Error ? error.message : "Could not import these audio files.");
    } finally {
      setBusy(false);
    }
  };

  const removeMixAsset = async (id: string) => {
    try {
      await deleteProjectMedia(project.id, id);
      updateAssets(assets.filter((asset) => asset.id !== id).map((asset, index) => ({ ...asset, order: index })));
      setNotice("Removed the local audio asset.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not remove this audio asset.");
    }
  };

  const stopPreview = () => {
    previewSources.current.forEach((source) => { try { source.stop(); } catch { /* already ended */ } });
    previewSources.current = [];
    setPreviewing(false);
  };

  const previewMix = async () => {
    if (previewing) {
      stopPreview();
      return;
    }
    setBusy(true);
    setNotice("Preparing local mix preview…");
    try {
      const context = previewContext.current ?? new AudioContext();
      previewContext.current = context;
      await context.resume();
      const enabled = audibleTrackIds(tracks);
      const trackByKind = new Map(tracks.map((track) => [track.kind, track]));
      const events: Array<{ blob: Blob; start: number; duration: number; track: AudioMixTrack }> = [];
      const sceneClips = new Map((project.timelineClips ?? []).filter((clip) => clip.track === "audio").map((clip) => [clip.sceneId, clip]));
      const offsets = new Map<string, number>();
      const sceneIndex = new Map(project.scenes.map((scene, index) => [scene.id, index]));
      const speech = [...(project.audioSegments ?? [])].filter((segment) => segment.status === "ready").sort((left, right) => {
        const order = (sceneIndex.get(left.sceneId) ?? 0) - (sceneIndex.get(right.sceneId) ?? 0);
        if (order) return order;
        const scene = project.scenes.find((item) => item.id === left.sceneId);
        return (scene?.blocks.findIndex((block) => block.id === left.blockId) ?? 0)
          - (scene?.blocks.findIndex((block) => block.id === right.blockId) ?? 0);
      });
      for (const segment of speech) {
        const scene = project.scenes.find((item) => item.id === segment.sceneId);
        const block = scene?.blocks.find((item) => item.id === segment.blockId);
        const kind = block?.kind === "dialogue" ? "dialogue" : "narration";
        const track = trackByKind.get(kind);
        if (!track || !enabled.has(track.id)) continue;
        const clip = sceneClips.get(segment.sceneId);
        const start = (clip?.startSeconds ?? 0) + (offsets.get(segment.sceneId) ?? 0);
        const blob = await readGeneratedAudio(project.id, segment.id);
        if (!blob) {
          offsets.set(segment.sceneId, (offsets.get(segment.sceneId) ?? 0) + (segment.durationSeconds ?? 0));
          continue;
        }
        const measured = await context.decodeAudioData(await blob.arrayBuffer());
        const duration = Math.min(measured.duration, Math.max(0, (clip?.startSeconds ?? 0) + (clip?.durationSeconds ?? measured.duration) - start));
        offsets.set(segment.sceneId, (offsets.get(segment.sceneId) ?? 0) + measured.duration);
        if (duration > 0) events.push({ blob, start, duration, track });
      }
      for (const asset of assets) {
        const track = tracks.find((item) => item.id === asset.trackId);
        if (!track || !enabled.has(track.id)) continue;
        const blob = await readProjectMedia(project.id, asset.id);
        if (blob) events.push({ blob, start: asset.startSeconds, duration: asset.durationSeconds, track });
      }
      if (!events.length) {
        setNotice("Nothing is ready to preview. Generate speech or import a music/SFX file first.");
        return;
      }
      const origin = context.currentTime + 0.12;
      for (const event of events) {
        const decoded = await context.decodeAudioData(await event.blob.arrayBuffer());
        const source = context.createBufferSource();
        source.buffer = decoded;
        const gain = context.createGain();
        const automation = buildGainAutomation(
          Math.min(event.duration, decoded.duration),
          event.track.volume,
          event.track.fadeInSeconds,
          event.track.fadeOutSeconds,
        );
        gain.gain.setValueAtTime(automation[0]?.gain ?? event.track.volume, origin + event.start);
        for (const point of automation.slice(1)) gain.gain.linearRampToValueAtTime(point.gain, origin + event.start + point.timeSeconds);
        source.connect(gain);
        gain.connect(context.destination);
        source.start(origin + event.start, 0, Math.min(event.duration, decoded.duration));
        previewSources.current.push(source);
      }
      setPreviewing(true);
      setNotice("Mix preview is playing locally. Mute/solo, level and fade settings are applied.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not preview the local mix.");
    } finally {
      setBusy(false);
    }
  };

  const exportArchive = async () => {
    setBusy(true);
    setNotice("Collecting project metadata and local media…");
    try {
      const archive = await exportPortableProject(project);
      downloadPortableProject(archive, project.name);
      setNotice("Complete project archive exported. It includes editable project metadata and every referenced local media file.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not export the complete project archive.");
    } finally {
      setBusy(false);
    }
  };

  const restoreArchive = async (file?: File) => {
    if (!file) return;
    if (!onRestoreProject) {
      setNotice("Project restore is unavailable in this workspace.");
      return;
    }
    setBusy(true);
    setNotice("Validating archive paths, sizes, checksums and project metadata…");
    try {
      const restored = await importPortableProject(file);
      onRestoreProject(restored);
      setNotice("Project restored as a new local project. The original project was not changed.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not restore this project archive.");
    } finally {
      setBusy(false);
    }
  };

  const startRender = async () => {
    const controller = new AbortController();
    previewAbort.current = controller;
    setBusy(true);
    setJob(null);
    setNotice("Preparing a complete local render package…");
    try {
      const result = await renderProjectLocally(project, endpoint, (next) => {
        setJob(next);
        setNotice(next.message || "Local renderer: " + next.status);
      }, controller.signal);
      downloadRenderedVideo(result.blob, project.name);
      setNotice("MP4 rendered and downloaded. The local renderer reported validated codec, dimensions, frame rate and duration.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Local rendering failed.");
    } finally {
      previewAbort.current = null;
      setBusy(false);
    }
  };

  const downloadColabNotebook = () => {
    downloadMotionPackage(buildColabNotebook(), "GridSplit_Live_Colab_Renderer.ipynb");
    setNotice("Colab renderer notebook downloaded. Open it in Google Colab and run all cells.");
  };

  const connectColab = async () => {
    setColabChecking(true); setColabConnected(false); setNotice("Connecting directly to the Colab runtime…");
    try { const status = await checkColabRenderer(colabEndpoint); setColabConnected(true); setNotice(status); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Could not connect to Colab."); }
    finally { setColabChecking(false); }
  };

  const startColabRender = async () => {
    const controller = new AbortController(); colabAbort.current = controller;
    setColabBusy(true); setColabProgress({ stage: "uploading", progress: 0, message: "Preparing project media for Colab…" });
    try {
      const result = await renderProjectOnColab(project, colabEndpoint, (progress) => { setColabProgress(progress); setNotice(progress.message); }, controller.signal);
      downloadRenderedVideo(result.blob, project.name); setNotice("Colab MP4 rendered and downloaded successfully.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Colab rendering failed."); }
    finally { colabAbort.current = null; setColabBusy(false); }
  };
  const cancelColabRender = () => colabAbort.current?.abort();
  const renderErrors = readyIssues.filter((issue) => issue.severity === "error");
  const renderWarnings = readyIssues.filter((issue) => issue.severity === "warning");

  return <section className="production-tools">
    <header className="production-tools-head">
      <div><span className="production-kicker">M26–M31 · MIX, EFFECTS & DELIVERY</span><h2>Finish the cut.</h2><p>Mix local audio, shape image motion, render with your own FFmpeg installation, and keep the entire project portable.</p></div>
      <WandSparkles size={25}/>
    </header>
    <nav className="production-tools-tabs" aria-label="Mix and export tools">
      <button className={tab === "mix" ? "active" : ""} onClick={() => setTab("mix")}><SlidersHorizontal size={14}/> 4. Audio mix</button>
      <button className={tab === "effects" ? "active" : ""} onClick={() => setTab("effects")}><Film size={14}/> 5. Effects</button>
      <button className={tab === "render" ? "active" : ""} onClick={() => setTab("render")}><Download size={14}/> 6. Export & restore</button>
    </nav>
    {notice && <p className="production-tools-notice" role="status">{notice}</p>}
    {tab === "mix" && <div className="production-tools-panel">
      <div className="production-tools-title"><div><h3>Audio mixer</h3><p>Four independent local tracks with gain, mute, solo and per-clip fade automation.</p></div><button className="production-tool-button primary" disabled={busy} onClick={() => void previewMix()}>{previewing ? <Pause size={14}/> : <Play size={14}/>} {previewing ? "Stop preview" : "Preview mix"}</button></div>
      <div className="mix-track-list">
        {tracks.map((track) => <article className="mix-track" key={track.id}>
          <div className="mix-track-name"><span className={"mix-track-icon " + track.kind}><Music2 size={15}/></span><div><b>{track.name}</b><small>{TRACK_LABELS[track.kind]} · {assets.filter((asset) => asset.trackId === track.id).length} imported asset(s)</small></div></div>
          <label className="mix-volume">Level <b>{Math.round(track.volume * 100)}%</b><input aria-label={track.name + " volume"} type="range" min="0" max="200" step="1" value={Math.round(track.volume * 100)} onChange={(event) => updateTrack(track.id, { volume: Number(event.target.value) / 100 })}/></label>
          <label className="mix-fade">Fade in <input aria-label={track.name + " fade in"} type="number" min="0" max="30" step="0.1" value={track.fadeInSeconds} onChange={(event) => updateTrack(track.id, { fadeInSeconds: Math.max(0, Math.min(30, Number(event.target.value) || 0)) })}/> s</label>
          <label className="mix-fade">Fade out <input aria-label={track.name + " fade out"} type="number" min="0" max="30" step="0.1" value={track.fadeOutSeconds} onChange={(event) => updateTrack(track.id, { fadeOutSeconds: Math.max(0, Math.min(30, Number(event.target.value) || 0)) })}/> s</label>
          <div className="mix-track-toggles"><button className={track.muted ? "selected" : ""} onClick={() => updateTrack(track.id, { muted: !track.muted })}>{track.muted ? "Unmute" : "Mute"}</button><button className={track.solo ? "selected" : ""} onClick={() => updateTrack(track.id, { solo: !track.solo })}>Solo</button></div>
        </article>)}
      </div>
      <div className="mix-import-row"><div><h3>Music & sound effects</h3><p>Import local files; they are copied into this project’s IndexedDB store.</p></div><select aria-label="Audio asset track" value={selectedTrack} onChange={(event) => setSelectedTrack(event.target.value as "music" | "sfx")}><option value="music">Music track</option><option value="sfx">SFX track</option></select><label className="production-tool-button"><Plus size={14}/> Add audio<input type="file" accept="audio/*" multiple disabled={busy} onChange={(event) => { void importAudio(event.target.files); event.currentTarget.value = ""; }}/></label></div>
      {assets.length ? <div className="mix-asset-list">{assets.map((asset) => <article key={asset.id}><div><b>{asset.name}</b><small>{TRACK_LABELS[asset.kind]} · {formatTime(asset.durationSeconds)} · {(asset.bytes / 1024 / 1024).toFixed(1)} MB</small></div>{asset.kind === "sfx" ? <label>Sync to scene <select aria-label={"Scene for "+asset.name} value={asset.sceneId??""} onChange={(event) => updateAssets(assets.map((item) => item.id === asset.id ? { ...item, sceneId: event.target.value || undefined } : item))}><option value="">Manual placement</option>{project.scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.title}</option>)}</select></label> : <span className="mix-auto-sync-label">Auto · programme start</span>}<label>Start <input type="number" min="0" step="0.1" value={asset.startSeconds} onChange={(event) => updateAssets(assets.map((item) => item.id === asset.id ? { ...item, sceneId: asset.kind === "sfx" ? undefined : item.sceneId, startSeconds: Math.max(0, Number(event.target.value) || 0) } : item))}/> s</label><button onClick={() => void removeMixAsset(asset.id)}>Remove</button></article>)}</div> : <div className="production-tools-empty">Import music or SFX to create additional mix lanes.</div>}
      <p className="production-tools-footnote">Mute and solo state is shared by local preview and the renderer. Music automatically starts at the programme head. Assign each SFX clip to a scene and its start follows that scene as the timeline changes; choose Manual placement to take control.</p>
    </div>}
    {tab === "effects" && <div className="production-tools-panel">
      <div className="production-tools-title"><div><h3>Transitions & image motion</h3><p>Configure per-image-clip transitions and optional Ken Burns motion.</p></div><span>{imageClips.length} image clips</span></div>
      {!imageClips.length ? <div className="production-tools-empty">Build the image timeline before adding transitions and effects.</div> : <div className="effect-list">
        {imageClips.map((clip, index) => {
          const current = edits.find((edit) => edit.clipId === clip.id) ?? defaultEdit(clip.id);
          const imageName = data.imageAssets?.find((asset) => asset.id === clip.assetId)?.name ?? "Missing image";
          const saveEdit = (patch: Partial<VideoClipEdit>) => {
            const next = edits.filter((edit) => edit.clipId !== clip.id);
            updateEdits([...next, { ...current, ...patch }]);
          };
          return <article className="effect-card" key={clip.id}>
            <div className="effect-card-number">{String(index + 1).padStart(2, "0")}</div><div className="effect-card-body"><b>{imageName}</b><small>{formatTime(clip.startSeconds)} – {formatTime(clip.startSeconds + clip.durationSeconds)} · {clip.durationSeconds.toFixed(2)} s</small><div className="effect-controls">
              <label>Motion <select value={current.effect} onChange={(event) => saveEdit({ effect: event.target.value as ImageEffectKind })}><option value="none">Static</option><option value="ken-burns">Ken Burns</option><option value="pan-left">Pan left</option><option value="pan-right">Pan right</option><option value="zoom-in">Zoom in</option><option value="zoom-out">Zoom out</option></select></label>
              <label>Transition in <select value={current.transitionIn} onChange={(event) => saveEdit({ transitionIn: event.target.value as TransitionKind })}><option value="cut">Cut</option><option value="fade">Fade</option><option value="dissolve">Dissolve</option><option value="wipe-left">Wipe left</option><option value="wipe-right">Wipe right</option></select></label>
              <label>Transition out <select value={current.transitionOut} onChange={(event) => saveEdit({ transitionOut: event.target.value as TransitionKind })}><option value="cut">Cut</option><option value="fade">Fade</option><option value="dissolve">Dissolve</option><option value="wipe-left">Wipe left</option><option value="wipe-right">Wipe right</option></select></label>
              <label>Transition length <input type="number" min="0" max="5" step="0.1" value={current.transitionDurationSeconds} onChange={(event) => saveEdit({ transitionDurationSeconds: Math.max(0, Math.min(5, Number(event.target.value) || 0)) })}/> s</label>
            </div></div>
          </article>;
        })}
      </div>}
      <p className="production-tools-footnote">Transition and motion choices are stored as editable project data and interpreted by the local FFmpeg renderer. No remote image or video service is used.</p>
    </div>}
    {tab === "render" && <div className="production-tools-panel">
      <div className="production-tools-title"><div><h3>Local MP4 export</h3><p>Local MP4 export uses your own FFmpeg installation. The Colab option below sends a portable archive to your active Colab runtime.</p></div><span className="local-only-pill">LOCAL ONLY</span></div>
      <div className="render-profile">
        <label>Aspect ratio <select value={profile.aspectRatio} onChange={(event) => { const ratio = event.target.value as RenderProfile["aspectRatio"]; updateProfile({ ...profile, aspectRatio: ratio, width: ratio === "9:16" ? 1080 : ratio === "1:1" ? 1080 : 1920, height: ratio === "9:16" ? 1920 : ratio === "1:1" ? 1080 : 1080 }); }}><option value="16:9">Landscape · 16:9</option><option value="9:16">Portrait · 9:16</option><option value="1:1">Square · 1:1</option></select></label>
        <label>Resolution <select value={profile.width + "x" + profile.height} onChange={(event) => { const [width, height] = event.target.value.split("x").map(Number); updateProfile({ ...profile, width, height }); }}><option value="1920x1080">1920 × 1080</option><option value="1280x720">1280 × 720</option><option value="1080x1920">1080 × 1920</option><option value="1080x1080">1080 × 1080</option></select></label>
        <label>Frame rate <select value={profile.fps} onChange={(event) => updateProfile({ ...profile, fps: Number(event.target.value) })}><option value="24">24 FPS</option><option value="25">25 FPS</option><option value="30">30 FPS</option><option value="60">60 FPS</option></select></label>
        <label>Quality <select value={profile.quality} onChange={(event) => updateProfile({ ...profile, quality: event.target.value as RenderProfile["quality"] })}><option value="high">High quality</option><option value="balanced">Balanced</option><option value="compact">Smaller file</option></select></label>
      </div>
      <label className="render-endpoint">Local renderer endpoint <input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} spellCheck={false}/></label>
      {renderErrors.length > 0 && <div className="render-checks errors"><b>Resolve before rendering</b>{renderErrors.map((issue) => <p key={issue.code}>{issue.message}</p>)}</div>}
      {renderWarnings.length > 0 && <div className="render-checks warnings"><b>Review these warnings</b>{renderWarnings.map((issue) => <p key={issue.code}>{issue.message}</p>)}</div>}
      {job && <div className="render-progress"><div><b>{job.status}</b><span>{job.progress}%</span></div><progress max="100" value={job.progress}/><small>{job.message || job.error}</small></div>}
      <div className="render-actions"><button className="production-tool-button" disabled={busy} onClick={() => void exportArchive()}><Download size={14}/> Export project ZIP</button><button className="production-tool-button primary" disabled={busy || renderErrors.length > 0} onClick={() => void startRender()}><Film size={14}/> Render MP4 locally</button>{busy && job && (job.status === "queued" || job.status === "running") && <button className="production-tool-button danger" onClick={cancelRender}>Cancel render</button>}</div>
      <section className="colab-render-card">
        <div className="colab-render-heading"><div><span className="colab-render-eyebrow"><Cloud size={13}/> GOOGLE COLAB · GPU RENDERING</span><h3>Render with Google Colab</h3><p>Use a Colab GPU to render this complete project, then bring the MP4 straight back here.</p></div><span className={colabConnected ? "colab-connection-pill connected" : "colab-connection-pill"}>{colabConnected ? "CONNECTED" : "NOT CONNECTED"}</span></div>
        <button className="production-tool-button" type="button" disabled={colabBusy} onClick={downloadColabNotebook}><Cloud size={14}/> Download Colab notebook (.ipynb)</button>
        <label className="render-endpoint">Colab Quick Tunnel URL<input value={colabEndpoint} disabled={colabBusy} spellCheck={false} placeholder="https://your-session.trycloudflare.com" onChange={(event) => { setColabEndpoint(event.target.value); setColabConnected(false); setColabProgress(null); }}/></label>
        <div className="colab-render-actions"><button className="production-tool-button" type="button" disabled={colabChecking || colabBusy || !colabEndpoint.trim()} onClick={() => void connectColab()}>{colabChecking ? <Loader2 size={14}/> : <RefreshCw size={14}/>} {colabChecking ? "Connecting…" : "Connect to Colab"}</button><button className="production-tool-button primary" type="button" disabled={!colabConnected || colabBusy || renderErrors.length > 0} onClick={() => void startColabRender()}><Cloud size={14}/> Render MP4 on Colab</button>{colabBusy && <button className="production-tool-button danger" type="button" onClick={cancelColabRender}>Cancel</button>}</div>
        {colabProgress && <div className="colab-render-progress"><div><b>{colabProgress.stage === "uploading" ? "Uploading project" : colabProgress.stage === "rendering" ? "Rendering on Colab" : "Downloading MP4"}</b><span>{colabProgress.progress}%</span></div><progress max="100" value={colabProgress.progress}/><small>{colabProgress.message}</small></div>}
        <p className="colab-render-footnote">Direct browser-to-Colab connection. No GridSplit account, token, or authentication step. Keep the Colab tab running until the MP4 downloads. Google controls GPU availability and session limits.</p>
      </section>
      <div className="restore-archive-row"><label className="production-tool-button"><Upload size={14}/> Restore project archive<input type="file" accept=".zip,.gridsplit.zip,application/zip" disabled={busy} onChange={(event) => { void restoreArchive(event.target.files?.[0]); event.currentTarget.value = ""; }}/></label><small>Restores as a new project. Existing projects and their media are kept.</small></div>
      <p className="production-tools-footnote">The renderer validates the finished MP4 with ffprobe before returning it. FFmpeg and ffprobe must be installed on this computer; nothing is downloaded or bundled by GridSplit.</p>
      <details className="renderer-install"><summary>Set up the optional local renderer</summary><ol><li>Install FFmpeg and ensure both <code>ffmpeg</code> and <code>ffprobe</code> are available in your PATH.</li><li>For local Vite development, run <code>python local-render/server.py --allow-origin http://localhost:5173</code> from the repository root.</li><li>To use this public website, run <code>python local-render/server.py --allow-origin https://gridsplit-kappa.vercel.app</code>. To allow both origins, pass both <code>--allow-origin</code> flags on the same command.</li><li>The renderer must run on this same computer and remain bound to <code>127.0.0.1</code>. Keep the endpoint above set to <code>http://127.0.0.1:8766</code>; never expose the renderer on a LAN or point GridSplit at a remote render server.</li></ol></details>
    </div>}
  </section>;
}
