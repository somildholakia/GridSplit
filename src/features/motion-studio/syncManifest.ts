export type MotionSyncImage = {
  fileName: string;
  startSeconds: number;
  endSeconds: number;
  matchedText?: string;
  confidence?: number;
  matchSimilarity?: number;
};

export type MotionSyncManifest = {
  format: "gridsplit-motion-sync";
  version: 1;
  audio: { fileName: string; durationSeconds: number };
  analysis?: { method?: string; imageCount?: number; transcriptLanguage?: string };
  images: MotionSyncImage[];
};

export type TimelinePosition = { index: number; progress: number };

export function normalizeMediaFilename(value: string): string {
  const name = value.replace(/\\/g, "/").split("/").pop() ?? "";
  return name.normalize("NFC").trim().toLocaleLowerCase();
}

export function parseMotionSyncManifest(value: unknown): MotionSyncManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The synchronization file must contain a JSON object.");
  }
  const input = value as Record<string, unknown>;
  if (input.format !== "gridsplit-motion-sync" || input.version !== 1) {
    throw new Error("Unsupported synchronization JSON. Export a GridSplit Smart Sync manifest (version 1).");
  }
  const audio = input.audio;
  if (!audio || typeof audio !== "object" || Array.isArray(audio)) {
    throw new Error("The synchronization JSON is missing its audio metadata.");
  }
  const audioInfo = audio as Record<string, unknown>;
  if (typeof audioInfo.fileName !== "string" || !audioInfo.fileName.trim()
    || typeof audioInfo.durationSeconds !== "number"
    || !Number.isFinite(audioInfo.durationSeconds) || audioInfo.durationSeconds <= 0) {
    throw new Error("The synchronization JSON contains invalid audio metadata.");
  }
  const audioDurationSeconds = audioInfo.durationSeconds;
  if (!Array.isArray(input.images) || input.images.length === 0 || input.images.length > 10000) {
    throw new Error("The synchronization JSON must contain between 1 and 10,000 image records.");
  }
  const seen = new Set<string>();
  const images = input.images.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("Synchronization image record " + (index + 1) + " is invalid.");
    }
    const item = raw as Record<string, unknown>;
    if (typeof item.fileName !== "string" || !item.fileName.trim()) {
      throw new Error("Synchronization image record " + (index + 1) + " has no fileName.");
    }
    const key = normalizeMediaFilename(item.fileName);
    if (!key || seen.has(key)) throw new Error("The synchronization JSON contains duplicate image filenames.");
    seen.add(key);
    const startSeconds = item.startSeconds;
    const endSeconds = item.endSeconds;
    if (typeof startSeconds !== "number" || typeof endSeconds !== "number"
      || !Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)
      || startSeconds < 0 || endSeconds <= startSeconds || endSeconds > audioDurationSeconds + 0.5) {
      throw new Error("Image timing is invalid for " + item.fileName + ".");
    }
    const confidence = typeof item.confidence === "number" && Number.isFinite(item.confidence)
      ? Math.max(0, Math.min(1, item.confidence)) : undefined;
    return {
      fileName: item.fileName,
      startSeconds,
      endSeconds,
      ...(typeof item.matchedText === "string" ? { matchedText: item.matchedText } : {}),
      ...(confidence !== undefined ? { confidence } : {}),
      ...(typeof item.matchSimilarity === "number" && Number.isFinite(item.matchSimilarity)
        ? { matchSimilarity: item.matchSimilarity } : {}),
    };
  });
  return {
    format: "gridsplit-motion-sync",
    version: 1,
    audio: { fileName: audioInfo.fileName, durationSeconds: audioDurationSeconds },
    ...(input.analysis && typeof input.analysis === "object" && !Array.isArray(input.analysis)
      ? { analysis: input.analysis as MotionSyncManifest["analysis"] } : {}),
    images,
  };
}

export function resolveMotionSyncManifest(
  manifest: MotionSyncManifest,
  imageNames: string[],
  audioFileName: string,
  actualAudioDuration: number,
): number[] {
  if (!imageNames.length) throw new Error("Import your images before applying synchronization JSON.");
  if (!audioFileName || normalizeMediaFilename(manifest.audio.fileName) !== normalizeMediaFilename(audioFileName)) {
    throw new Error("The synchronization JSON was generated for a different audio file.");
  }
  if (!Number.isFinite(actualAudioDuration) || actualAudioDuration <= 0
    || Math.abs(manifest.audio.durationSeconds - actualAudioDuration) > Math.max(0.5, actualAudioDuration * 0.0005)) {
    throw new Error("The audio duration does not match the synchronization JSON. Re-analyze the current audio file.");
  }
  if (manifest.images.length !== imageNames.length) {
    throw new Error("Image count mismatch: the JSON contains " + manifest.images.length
      + " images, but Motion Studio has " + imageNames.length + ".");
  }
  const byName = new Map(manifest.images.map((item) => [normalizeMediaFilename(item.fileName), item]));
  const actualNames = new Set(imageNames.map(normalizeMediaFilename));
  if (actualNames.size !== imageNames.length) throw new Error("Motion Studio has duplicate image filenames; rename them before syncing.");
  if (manifest.images.some((item) => !actualNames.has(normalizeMediaFilename(item.fileName)))) {
    throw new Error("One or more image filenames in the synchronization JSON are missing from Motion Studio.");
  }
  let cursor = 0;
  for (const item of manifest.images) {
    if (Math.abs(item.startSeconds - cursor) > 0.08) {
      throw new Error("The synchronization timeline has a gap or overlap near " + item.fileName + ".");
    }
    cursor = item.endSeconds;
    if (item.endSeconds - item.startSeconds < 0.2) {
      throw new Error("Image holds must be at least 0.2 seconds.");
    }
  }
  if (Math.abs(cursor - actualAudioDuration) > Math.max(0.5, actualAudioDuration * 0.0005)) {
    throw new Error("The synchronization timeline does not cover the complete soundtrack.");
  }
  return imageNames.map((name) => {
    const item = byName.get(normalizeMediaFilename(name));
    if (!item) throw new Error("Missing image timing for " + name + ".");
    return item.endSeconds - item.startSeconds;
  });
}

export function buildImageTimelineFromDurations(
  assetIds: string[],
  audioDurationSeconds: number,
  sceneId: string,
  requestedDurations: number[],
  makeId: () => string = () => crypto.randomUUID(),
) {
  if (!assetIds.length || assetIds.length !== requestedDurations.length) {
    throw new Error("Every image must have exactly one synchronization duration.");
  }
  if (!sceneId.trim() || !Number.isFinite(audioDurationSeconds) || audioDurationSeconds <= 0) {
    throw new Error("A valid scene and audio duration are required.");
  }
  const durations = requestedDurations.map(Number);
  if (durations.some((duration) => !Number.isFinite(duration) || duration <= 0)) {
    throw new Error("Every image duration must be finite and greater than zero.");
  }
  const sum = durations.reduce((total, duration) => total + duration, 0);
  if (Math.abs(sum - audioDurationSeconds) > Math.max(0.5, audioDurationSeconds * 0.0005)) {
    throw new Error("Image timings do not cover the complete soundtrack.");
  }
  durations[durations.length - 1] += audioDurationSeconds - sum;
  let cursor = 0;
  return assetIds.map((assetId, index) => {
    const durationSeconds = durations[index];
    const clip = {
      id: makeId(),
      track: "images" as const,
      sceneId,
      assetId,
      startSeconds: cursor,
      durationSeconds,
      order: index,
    };
    cursor += durationSeconds;
    return clip;
  });
}

export function getTimelinePosition(timeSeconds: number, durations: number[]): TimelinePosition | null {
  if (!durations.length || durations.some((duration) => !Number.isFinite(duration) || duration <= 0)) return null;
  const total = durations.reduce((sum, duration) => sum + duration, 0);
  const time = Math.max(0, Math.min(Number.isFinite(timeSeconds) ? timeSeconds : 0, Math.max(0, total - 0.001)));
  let cursor = 0;
  for (let index = 0; index < durations.length; index += 1) {
    const end = cursor + durations[index];
    if (time < end || index === durations.length - 1) {
      return { index, progress: Math.max(0, Math.min(1, (time - cursor) / durations[index])) };
    }
    cursor = end;
  }
  return null;
}
