import { useState } from "react";
import { Download, FileJson, FileText, RefreshCw, ShieldCheck } from "lucide-react";
import type { StudioProject } from "../../lib/projectStore";
import { readGeneratedAudio } from "../../audio/audioStore";
import { buildSynchronizationMetadata, measureWavBlob, toSrt, toVtt, type SynchronizationMetadata } from "../../lib/mediaTimeline";
import "./media-export-panel.css";

function saveText(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function safeName(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "gridsplit-project";
}
function durationLabel(seconds: number) {
  const mins = Math.floor(seconds / 60), secs = (seconds % 60).toFixed(2).padStart(5, "0");
  return `${mins}:${secs}`;
}

export default function MediaExportPanel({ project }: { project: StudioProject }) {
  const [metadata, setMetadata] = useState<SynchronizationMetadata | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const readyCount = (project.audioSegments ?? []).filter((segment) => segment.status === "ready").length;

  const prepare = async () => {
    setBusy(true); setMessage("Measuring saved WAV files from their actual sample headers…");
    try {
      const inputs = [];
      const missing: string[] = [];
      for (const segment of project.audioSegments ?? []) {
        if (segment.status !== "ready") continue;
        const scene = project.scenes.find((item) => item.id === segment.sceneId);
        const block = scene?.blocks.find((item) => item.id === segment.blockId);
        if (!block) { missing.push(segment.id); continue; }
        try {
          const blob = await readGeneratedAudio(project.id, segment.id);
          if (!blob) { missing.push(segment.id); continue; }
          const measured = await measureWavBlob(blob);
          inputs.push({
            id: segment.id, sceneId: segment.sceneId, blockId: segment.blockId,
            text: block.text, ...(block.kind === "dialogue" ? { speaker: block.speaker ?? "Unknown speaker" } : {}),
            sampleCount: measured.sampleCount, sampleRate: measured.sampleRate, channels: measured.channels,
          });
        } catch { missing.push(segment.id); }
      }
      if (!inputs.length) {
        setMetadata(null);
        setMessage("No readable, generated WAV segments are available yet. Generate audio first.");
        return;
      }
      const result = buildSynchronizationMetadata(inputs);
      setMetadata(result);
      setMessage(`Measured ${inputs.length} WAV segments from sample counts.${missing.length ? ` ${missing.length} missing or invalid segment(s) were skipped.` : ""}`);
    } catch (error) {
      setMetadata(null);
      setMessage(error instanceof Error ? error.message : "Could not prepare media timing.");
    } finally { setBusy(false); }
  };

  const base = safeName(project.name);
  return <section className="audio-panel media-export-panel">
    <div className="audio-panel-title"><div><span className="audio-step">M17–M19</span><div><h2>Timing, sync & subtitles</h2><p>Measure the saved WAV headers, then export exact scene timing and segment-level captions.</p></div></div>
      <span className="audio-count">{readyCount} WAV ready</span></div>
    <div className="media-export-actions">
      <button className="audio-primary-button" disabled={!readyCount || busy} onClick={() => void prepare()}><RefreshCw size={14}/>{busy ? "Measuring…" : "Measure & build timeline"}</button>
      <button className="audio-secondary-button" disabled={!metadata} onClick={() => metadata && saveText(`${base}-sync.json`, JSON.stringify(metadata, null, 2), "application/json")}><FileJson size={14}/> Sync JSON</button>
      <button className="audio-secondary-button" disabled={!metadata} onClick={() => metadata && saveText(`${base}.srt`, toSrt(metadata), "application/x-subrip")}><FileText size={14}/> SRT</button>
      <button className="audio-secondary-button" disabled={!metadata} onClick={() => metadata && saveText(`${base}.vtt`, toVtt(metadata), "text/vtt")}><FileText size={14}/> VTT</button>
    </div>
    {metadata && <div className="media-export-result"><b>{metadata.segments.length} segments · {metadata.scenes.length} scenes · {durationLabel(metadata.totalDurationSeconds)} total</b><span>Exact rational timestamps are retained in the JSON. Subtitle cues are segment-level, not word-aligned.</span></div>}
    {message && <p className="media-export-message" role="status"><ShieldCheck size={13}/>{message}</p>}
  </section>;
}
