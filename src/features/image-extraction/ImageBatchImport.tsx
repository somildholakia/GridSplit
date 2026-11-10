import { useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { Download, FolderOpen, Images, Trash2, Upload } from "lucide-react";
import { validateImageBatch, type ImageImportEntry } from "../../lib/imageBatch";
import "./image-batch-import.css";

export default function ImageBatchImport() {
  const [entries, setEntries] = useState<ImageImportEntry[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const folderRef = useRef<HTMLInputElement>(null);
  useEffect(() => { folderRef.current?.setAttribute("webkitdirectory", ""); folderRef.current?.setAttribute("directory", ""); }, []);
  const totalBytes = useMemo(() => entries.reduce((sum, item) => sum + item.file.size, 0), [entries]);

  const addFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const result = validateImageBatch(files);
    setEntries((current) => {
      const merged = [...current, ...result.accepted];
      return validateImageBatch(merged.map((item) => item.file)).accepted;
    });
    setRejected(result.rejected);
  };
  const exportBundle = async () => {
    if (!entries.length) return;
    setBusy(true);
    try {
      const zip = new JSZip();
      const folder = zip.folder("gridsplit-image-sequence");
      if (!folder) throw new Error("Could not create the image bundle.");
      const manifest = ["order,filename,relative_path,bytes,mime_type"];
      entries.forEach((entry, index) => {
        const safeName = entry.file.name.replace(/[\\/:*?"<>|]/g, "_");
        const filename = `${String(index + 1).padStart(4, "0")}-${safeName}`;
        folder.file(filename, entry.file);
        manifest.push([`"${index + 1}"`, `"${filename.replaceAll('"', '""')}"`, `"${entry.relativePath.replaceAll('"', '""')}"`, entry.file.size, `"${entry.file.type}"`].join(","));
      });
      zip.file("manifest.csv", manifest.join("\n"));
      zip.file("README.txt", "GridSplit local image intake bundle. Files are copied unchanged and ordered naturally by filename.\nNo files were uploaded to a server.\n");
      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 4 } });
      const url = URL.createObjectURL(blob), anchor = document.createElement("a");
      anchor.href = url; anchor.download = "gridsplit-image-sequence.zip"; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (error) {
      setRejected([error instanceof Error ? error.message : "Could not create the image bundle."]);
    } finally { setBusy(false); }
  };

  return <section className="image-batch-panel">
    <div className="image-batch-heading"><div><span className="image-batch-kicker">M21 · IMAGE INTAKE</span><h2>Bring in a whole storyboard.</h2><p>Select multiple numbered images or an entire folder. Files stay in this browser and are sorted naturally.</p></div><Images size={25}/></div>
    <div className="image-batch-actions">
      <label className="image-batch-button"><Upload size={15}/> Add images<input type="file" accept="image/*" multiple onChange={(event) => { addFiles(event.target.files); event.currentTarget.value = ""; }}/></label>
      <button type="button" className="image-batch-button" onClick={() => folderRef.current?.click()}><FolderOpen size={15}/> Choose folder</button>
      <input ref={folderRef} className="image-batch-hidden" type="file" accept="image/*" multiple onChange={(event) => { addFiles(event.target.files); event.currentTarget.value = ""; }}/>
      <button type="button" className="image-batch-button image-batch-clear" disabled={!entries.length} onClick={() => { setEntries([]); setRejected([]); }}><Trash2 size={14}/> Clear</button>
      <button type="button" className="image-batch-button image-batch-export" disabled={!entries.length || busy} onClick={() => void exportBundle()}><Download size={14}/>{busy ? "Preparing…" : `Export ${entries.length} images`}</button>
    </div>
    <div className="image-batch-summary">{entries.length} images · ${(totalBytes / (1024 * 1024)).toFixed(1)} MB · original files preserved</div>
    {entries.length > 0 && <ol className="image-batch-list">{entries.map((entry, index) => <li key={entry.relativePath + entry.file.size + entry.file.lastModified}><span>{String(index + 1).padStart(3, "0")}</span><b>{entry.file.name}</b><small>{entry.relativePath !== entry.file.name ? entry.relativePath : "Selected file"}</small><small>{(entry.file.size / 1024).toFixed(0)} KB</small><button type="button" aria-label={`Remove ${entry.file.name}`} onClick={() => setEntries((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={13}/></button></li>)}</ol>}
    {rejected.length > 0 && <ul className="image-batch-errors">{rejected.map((message, index) => <li key={index}>{message}</li>)}</ul>}
    <p className="image-batch-note">This is an intake bundle, not yet the scene-to-image timeline. Mapping and timeline editing are later milestones.</p>
  </section>;
}
