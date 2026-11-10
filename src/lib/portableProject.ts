import JSZip from "jszip";
import type { StudioProject } from "./projectStore";
import { buildSynchronizationMetadata, measureWavBlob, toSrt, toVtt } from "./mediaTimeline";
import type { SyncSegmentInput } from "./mediaTimeline";
import { duplicateProject } from "./projectStore";
import { deleteGeneratedAudio, readGeneratedAudio, saveGeneratedAudio } from "../audio/audioStore";
import {
  deleteProjectImageBlob,
  deleteProjectMedia,
  readProjectImageBlob,
  readProjectMedia,
  saveProjectImageBlob,
  saveProjectMedia,
} from "./projectMediaStore";
import type { AudioMixTrack, MixAudioAsset, VideoClipEdit, RenderProfile } from "../domain/production";

type PortableProject = StudioProject & {
  audioMixTracks?: AudioMixTrack[];
  mixAssets?: MixAudioAsset[];
  videoClipEdits?: VideoClipEdit[];
  renderProfile?: RenderProfile;
};

export interface PortableFileRecord {
  path: string;
  kind: "image" | "generated-audio" | "mix-audio";
  assetId: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

export interface PortableManifest {
  format: "gridsplit-studio-project";
  version: 1;
  createdAt: string;
  projectId: string;
  files: PortableFileRecord[];
}

const ARCHIVE_VERSION = 1;
const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_FILES = 1600;

function safeSegment(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9_-]/g, "_");
  if (!safe || safe === "." || safe === "..") throw new Error("The project contains an unsafe media identifier.");
  return safe;
}
function safeExtension(name: string, mimeType: string): string {
  const extension = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (/^[a-z0-9]{1,8}$/.test(extension)) return "." + extension;
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "audio/wav" || mimeType === "audio/x-wav") return ".wav";
  if (mimeType === "audio/mpeg") return ".mp3";
  if (mimeType === "audio/ogg") return ".ogg";
  if (mimeType === "audio/mp4") return ".m4a";
  return ".bin";
}
async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportPortableProject(project: StudioProject): Promise<Blob> {
  const data = project as PortableProject;
  const zip = new JSZip();
  const files: PortableFileRecord[] = [];
  let totalBytes = 0;

  const add = async (path: string, kind: PortableFileRecord["kind"], assetId: string, blob: Blob, mimeType: string) => {
    if (blob.size <= 0) throw new Error("Cannot package an empty media file: " + path);
    totalBytes += blob.size;
    if (totalBytes > MAX_UNCOMPRESSED_BYTES) throw new Error("The project media exceeds the 2 GB portable archive limit.");
    zip.file(path, blob, { date: new Date("2000-01-01T00:00:00.000Z") });
    files.push({ path, kind, assetId, mimeType, sizeBytes: blob.size, sha256: await sha256(blob) });
  };

  for (const asset of data.imageAssets ?? []) {
    const blob = await readProjectImageBlob(asset.id);
    if (!blob) throw new Error("Missing original image: " + asset.name + ". Re-import it before exporting a complete project.");
    await add("media/images/" + safeSegment(asset.id) + safeExtension(asset.name, asset.mimeType), "image", asset.id, blob, blob.type || asset.mimeType);
  }
  const synchronizationInputs: SyncSegmentInput[] = [];
  for (const scene of project.scenes) {
    for (const block of scene.blocks) {
      if (block.kind !== "narration" && block.kind !== "dialogue") continue;
      const segment = (project.audioSegments ?? []).find((item) =>
        item.sceneId === scene.id && item.blockId === block.id && item.status === "ready");
      if (!segment) continue;
      const blob = await readGeneratedAudio(project.id, segment.id);
      if (!blob) throw new Error("Missing generated WAV for block " + segment.blockId + ". Restore the audio before exporting.");
      const measured = await measureWavBlob(blob);
      await add("media/generated-audio/" + safeSegment(segment.id) + ".wav", "generated-audio", segment.id, blob, blob.type || "audio/wav");
      synchronizationInputs.push({
        id: segment.id,
        sceneId: scene.id,
        blockId: block.id,
        text: block.text,
        speaker: block.kind === "dialogue" ? block.speaker : undefined,
        sampleCount: measured.sampleCount,
        sampleRate: measured.sampleRate,
        channels: measured.channels,
      });
    }
  }
  for (const asset of data.mixAssets ?? []) {
    const blob = await readProjectMedia(project.id, asset.id);
    if (!blob) throw new Error("Missing music/SFX source file: " + asset.name + ".");
    await add("media/mix-audio/" + safeSegment(asset.id) + safeExtension(asset.name, asset.mimeType), "mix-audio", asset.id, blob, blob.type || asset.mimeType);
  }

  const projectJson = JSON.stringify(project, null, 2);
  const synchronization = buildSynchronizationMetadata(synchronizationInputs);
  zip.file("metadata/synchronization.json", JSON.stringify(synchronization, null, 2));
  zip.file("subtitles/subtitles.srt", toSrt(synchronization));
  zip.file("subtitles/subtitles.vtt", toVtt(synchronization));

  zip.file("project.json", projectJson);
  zip.file("README.md", [
    "# GridSplit Studio project archive",
    "",
    "This archive contains editable project metadata and the local media binaries referenced by that project.",
    "Restore it from GridSplit Studio using Production Studio → Export & restore → Restore project archive.",
    "",
    "All media was packaged locally. No project content was uploaded to a server.",
    "The archive manifest lists SHA-256 checksums for each bundled binary asset.",
    "",
    "GridSplit Studio portable project format v1.",
    "",
  ].join("\n"));
  const manifest: PortableManifest = {
    format: "gridsplit-studio-project",
    version: ARCHIVE_VERSION,
    createdAt: new Date().toISOString(),
    projectId: project.id,
    files: files.sort((left, right) => left.path.localeCompare(right.path)),
  };
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 4 } });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function validateManifest(value: unknown): PortableManifest {
  if (!isRecord(value) || value.format !== "gridsplit-studio-project" || value.version !== ARCHIVE_VERSION
    || typeof value.projectId !== "string" || !Array.isArray(value.files) || value.files.length > MAX_FILES) {
    throw new Error("This is not a supported GridSplit Studio project archive.");
  }
  const seen = new Set<string>();
  let total = 0;
  const files = value.files.map((entry): PortableFileRecord => {
    if (!isRecord(entry)
      || typeof entry.path !== "string"
      || !/^(media\/(images|generated-audio|mix-audio)\/)[a-zA-Z0-9_.-]+$/.test(entry.path)
      || entry.path.includes("..")
      || entry.path.includes("\\")
      || seen.has(entry.path)
      || !["image", "generated-audio", "mix-audio"].includes(String(entry.kind))
      || typeof entry.assetId !== "string"
      || typeof entry.mimeType !== "string"
      || !Number.isSafeInteger(entry.sizeBytes)
      || Number(entry.sizeBytes) <= 0
      || typeof entry.sha256 !== "string"
      || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error("The archive manifest contains an invalid or unsafe media entry.");
    }
    seen.add(entry.path);
    total += Number(entry.sizeBytes);
    return entry as unknown as PortableFileRecord;
  });
  if (total > MAX_UNCOMPRESSED_BYTES) throw new Error("The project archive exceeds the 2 GB uncompressed limit.");
  return { format: "gridsplit-studio-project", version: ARCHIVE_VERSION, createdAt: String(value.createdAt ?? ""), projectId: value.projectId, files };
}

function remapRestoredProject(source: PortableProject, makeId: () => string): {
  project: PortableProject;
  imageIds: Map<string, string>;
  segmentIds: Map<string, string>;
  mixAssetIds: Map<string, string>;
  trackIds: Map<string, string>;
} {
  const copy = duplicateProject(source, makeId, new Date().toISOString(), "Restored: ") as PortableProject;
  const sceneIds = new Map<string, string>();
  const blockIds = new Map<string, string>();
  source.scenes.forEach((scene, index) => {
    const nextScene = copy.scenes[index];
    if (!nextScene) return;
    sceneIds.set(scene.id, nextScene.id);
    scene.blocks.forEach((block, blockIndex) => {
      const nextBlock = nextScene.blocks[blockIndex];
      if (nextBlock) blockIds.set(block.id, nextBlock.id);
    });
  });

  const imageIds = new Map((source.imageAssets ?? []).map((asset) => [asset.id, makeId()]));
  const trackIds = new Map((source.audioMixTracks ?? []).map((track) => [track.id, makeId()]));
  const mixAssetIds = new Map((source.mixAssets ?? []).map((asset) => [asset.id, makeId()]));
  const segmentIds = new Map<string, string>();
  const audioSegments = (source.audioSegments ?? []).flatMap((segment) => {
    const sceneId = sceneIds.get(segment.sceneId);
    const blockId = blockIds.get(segment.blockId);
    if (!sceneId || !blockId) return [];
    const id = "segment:" + sceneId + ":" + blockId;
    segmentIds.set(segment.id, id);
    return [{ ...segment, id, sceneId, blockId, status: segment.status === "failed" ? "failed" as const : "pending" as const }];
  });
  const timelineClipIds = new Map((source.timelineClips ?? []).map((clip) => [clip.id, makeId()]));
  const imageMap = (id: string) => imageIds.get(id);
  const trackMap = (id: string) => trackIds.get(id);
  const copyProject: PortableProject = {
    ...copy,
    source: source.source,
    scenes: copy.scenes,
    audioSegments,
    imageAssets: (source.imageAssets ?? []).flatMap((asset) => {
      const id = imageMap(asset.id);
      return id ? [{ ...asset, id }] : [];
    }),
    imageMappings: (source.imageMappings ?? []).flatMap((mapping) => {
      const sceneId = sceneIds.get(mapping.sceneId);
      if (!sceneId) return [];
      return [{ ...mapping, sceneId, imageIds: mapping.imageIds.flatMap((id) => imageMap(id) ?? []) }];
    }),
    timelineClips: (source.timelineClips ?? []).flatMap((clip) => {
      const sceneId = sceneIds.get(clip.sceneId);
      const id = timelineClipIds.get(clip.id);
      if (!sceneId || !id) return [];
      return [{
        ...clip,
        id,
        sceneId,
        assetId: clip.assetId ? imageMap(clip.assetId) : undefined,
        segmentId: clip.segmentId ? segmentIds.get(clip.segmentId) : undefined,
      }];
    }),
    audioMixTracks: (source.audioMixTracks ?? []).map((track) => ({ ...track, id: trackMap(track.id) ?? makeId() })),
    mixAssets: (source.mixAssets ?? []).flatMap((asset) => {
      const id = mixAssetIds.get(asset.id);
      const trackId = trackMap(asset.trackId);
      return id && trackId ? [{ ...asset, id, trackId }] : [];
    }),
    videoClipEdits: (source.videoClipEdits ?? []).flatMap((edit) => {
      const clipId = timelineClipIds.get(edit.clipId);
      return clipId ? [{ ...edit, clipId }] : [];
    }),
    renderProfile: source.renderProfile,
    updatedAt: new Date().toISOString(),
  };
  return { project: copyProject, imageIds, segmentIds, mixAssetIds, trackIds };
}

export async function importPortableProject(blob: Blob, makeId: () => string = () => crypto.randomUUID()): Promise<StudioProject> {
  if (!(blob instanceof Blob) || blob.size <= 0 || blob.size > MAX_ARCHIVE_BYTES) {
    throw new Error("The project archive is empty or exceeds the 1 GB compressed limit.");
  }
  const zip = await JSZip.loadAsync(blob, { checkCRC32: true });
  const paths = Object.keys(zip.files);
  if (paths.length > MAX_FILES + 8) throw new Error("The project archive contains too many entries.");
  for (const path of paths) {
    if (path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => part === "..")) {
      throw new Error("The project archive contains an unsafe file path.");
    }
  }
  const manifestFile = zip.file("manifest.json");
  const projectFile = zip.file("project.json");
  if (!manifestFile || !projectFile) throw new Error("The archive is missing its manifest or editable project file.");
  const manifest = validateManifest(JSON.parse(await manifestFile.async("string")));
  const sourceValue: unknown = JSON.parse(await projectFile.async("string"));
  const { isStudioProject } = await import("./projectStore");
  if (!isStudioProject(sourceValue) || sourceValue.id !== manifest.projectId) {
    throw new Error("The archive project metadata is invalid or does not match its manifest.");
  }

  const verified = new Map<string, Blob>();
  for (const file of manifest.files) {
    const item = zip.file(file.path);
    if (!item || item.dir) throw new Error("The archive is missing a media file: " + file.path);
    const bytes = await item.async("uint8array");
    if (bytes.byteLength !== file.sizeBytes) throw new Error("Media size does not match the archive manifest: " + file.path);
    const media = new Blob([bytes], { type: file.mimeType });
    if (await sha256(media) !== file.sha256) throw new Error("Media checksum failed: " + file.path);
    verified.set(file.path, media);
  }

  const source = sourceValue as PortableProject;
  const remapped = remapRestoredProject(source, makeId);
  const savedImages: string[] = [];
  const savedAudio: string[] = [];
  const savedMix: string[] = [];
  try {
    for (const record of manifest.files) {
      const media = verified.get(record.path)!;
      if (record.kind === "image") {
        const newId = remapped.imageIds.get(record.assetId);
        if (!newId || !remapped.project.imageAssets?.some((asset) => asset.id === newId)) {
          throw new Error("The archive includes an image that is not referenced by the project.");
        }
        await saveProjectImageBlob(newId, media);
        savedImages.push(newId);
      } else if (record.kind === "generated-audio") {
        const newId = remapped.segmentIds.get(record.assetId);
        if (!newId || !remapped.project.audioSegments?.some((segment) => segment.id === newId)) {
          throw new Error("The archive includes audio that is not referenced by the project.");
        }
        await saveGeneratedAudio(remapped.project.id, newId, media);
        savedAudio.push(newId);
        remapped.project.audioSegments = remapped.project.audioSegments?.map((segment) => segment.id === newId
          ? { ...segment, status: "ready" as const }
          : segment);
      } else {
        const newId = remapped.mixAssetIds.get(record.assetId);
        if (!newId || !remapped.project.mixAssets?.some((asset) => asset.id === newId)) {
          throw new Error("The archive includes a music/SFX asset that is not referenced by the project.");
        }
        await saveProjectMedia(remapped.project.id, newId, media);
        savedMix.push(newId);
      }
    }
    const missingImages = (remapped.project.imageAssets ?? []).filter((asset) => !savedImages.includes(asset.id));
    if (missingImages.length) throw new Error("The archive is incomplete: one or more original image files are missing.");
    const missingMix = (remapped.project.mixAssets ?? []).filter((asset) => !savedMix.includes(asset.id));
    if (missingMix.length) throw new Error("The archive is incomplete: one or more music/SFX files are missing.");
    const readySegments = (remapped.project.audioSegments ?? []).filter((segment) => segment.status === "ready");
    if (readySegments.some((segment) => !savedAudio.includes(segment.id))) {
      remapped.project.audioSegments = remapped.project.audioSegments?.map((segment) => segment.status === "ready" && !savedAudio.includes(segment.id)
        ? { ...segment, status: "pending" as const }
        : segment);
    }
    return remapped.project;
  } catch (error) {
    await Promise.all([
      ...savedImages.map((id) => deleteProjectImageBlob(id).catch(() => undefined)),
      ...savedAudio.map((id) => deleteGeneratedAudio(remapped.project.id, id).catch(() => undefined)),
      ...savedMix.map((id) => deleteProjectMedia(remapped.project.id, id).catch(() => undefined)),
    ]);
    throw error;
  }
}

export function downloadPortableProject(blob: Blob, name: string): void {
  downloadBlob(blob, name.replace(/[^a-zA-Z0-9_-]+/g, "-") + ".gridsplit.zip");
}
