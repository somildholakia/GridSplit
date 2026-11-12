export type SequenceAsset = {
  id: string;
  name: string;
  relativePath: string;
  mimeType: string;
  bytes: number;
  sequenceNumber: number | null;
  order: number;
  width: number;
  height: number;
  fingerprint: string;
};

export type SequenceIssue = {
  kind: "gap" | "duplicate" | "unnumbered";
  message: string;
  assetIds: string[];
};

export type SceneImageMapping = { sceneId: string; imageIds: string[] };

export type TimelineClip = {
  id: string;
  track: "images" | "audio";
  sceneId: string;
  assetId?: string;
  segmentId?: string;
  startSeconds: number;
  durationSeconds: number;
  order: number;
};

export type SceneTimingInput = {
  sceneId: string;
  durationSeconds: number;
  imageIds: string[];
};

/** Read the last numeric token from a frame filename, ignoring its extension. */
export function extractSequenceNumber(name: string): number | null {
  const leaf = name.split(/[\\/]/).pop() ?? name;
  const stem = leaf.replace(/\.[^.]+$/, "");
  const match = stem.match(/(?:^|\D)(\d{1,8})(?=\D*$)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function sortSequence<T extends { name: string; relativePath: string }>(items: T[]): T[] {
  return [...items].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath, undefined, { numeric: true, sensitivity: "base" }),
  );
}

/** Return reviewable sequence issues; never remove a suspected duplicate automatically. */
export function analyseSequence(items: SequenceAsset[]): SequenceIssue[] {
  const issues: SequenceIssue[] = [];
  const numbered = items
    .filter((item) => item.sequenceNumber !== null && Number.isSafeInteger(item.sequenceNumber) && item.sequenceNumber >= 0)
    .sort((left, right) => left.sequenceNumber! - right.sequenceNumber! || left.order - right.order);

  const frameGroups = new Map<number, SequenceAsset[]>();
  for (const item of numbered) {
    const group = frameGroups.get(item.sequenceNumber!) ?? [];
    group.push(item);
    frameGroups.set(item.sequenceNumber!, group);
  }
  for (const [number, group] of frameGroups) {
    if (group.length > 1) {
      issues.push({
        kind: "duplicate",
        message: `Frame ${number} is assigned to ${group.length} files.`,
        assetIds: group.map((item) => item.id),
      });
    }
  }

  const fingerprintGroups = new Map<string, SequenceAsset[]>();
  for (const item of items) {
    if (!item.fingerprint) continue;
    const group = fingerprintGroups.get(item.fingerprint) ?? [];
    group.push(item);
    fingerprintGroups.set(item.fingerprint, group);
  }
  for (const group of fingerprintGroups.values()) {
    if (group.length > 1) {
      issues.push({
        kind: "duplicate",
        message: `${group.length} files share the same content fingerprint; review before removing any.`,
        assetIds: group.map((item) => item.id),
      });
    }
  }

  for (let index = 1; index < numbered.length; index += 1) {
    const previous = numbered[index - 1].sequenceNumber!;
    const current = numbered[index].sequenceNumber!;
    if (current - previous > 1) {
      issues.push({
        kind: "gap",
        message: `Missing frame(s) ${previous + 1}${current - previous > 2 ? `–${current - 1}` : ""} before ${numbered[index].name}.`,
        assetIds: [numbered[index - 1].id, numbered[index].id],
      });
    }
  }

  for (const item of items) {
    if (item.sequenceNumber === null) {
      issues.push({
        kind: "unnumbered",
        message: `${item.name} has no detectable frame number.`,
        assetIds: [item.id],
      });
    }
  }
  return issues;
}

/** Keep the mapping relation many-to-many while removing stale references and duplicate IDs. */
export function normalizeMappings(
  mappings: SceneImageMapping[],
  sceneIds: string[],
  assetIds: string[],
): SceneImageMapping[] {
  const validScenes = new Set(sceneIds);
  const validAssets = new Set(assetIds);
  const merged = new Map<string, string[]>();
  for (const mapping of mappings) {
    if (!validScenes.has(mapping.sceneId)) continue;
    const current = merged.get(mapping.sceneId) ?? [];
    const seen = new Set(current);
    for (const id of mapping.imageIds) {
      if (validAssets.has(id) && !seen.has(id)) {
        current.push(id);
        seen.add(id);
      }
    }
    merged.set(mapping.sceneId, current);
  }
  return [...merged].map(([sceneId, imageIds]) => ({ sceneId, imageIds }));
}

/** Keep each scene's image order aligned with the manually ordered asset sequence. */
export function orderMappingsByAssetOrder(
  mappings: SceneImageMapping[],
  assets: Array<Pick<SequenceAsset, "id" | "order">>,
): SceneImageMapping[] {
  const rank = new Map(assets.map((asset) => [asset.id, asset.order]));
  return mappings.map((mapping) => ({
    ...mapping,
    imageIds: [...mapping.imageIds].sort((left, right) =>
      (rank.get(left) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right) ?? Number.MAX_SAFE_INTEGER),
    ),
  }));
}

/** Build sequential image and scene-audio clips from actual measured scene durations. */
export function buildTimeline(
  inputs: SceneTimingInput[],
  makeId: () => string = () => crypto.randomUUID(),
): TimelineClip[] {
  let cursor = 0;
  const clips: TimelineClip[] = [];
  let imageOrder = 0;
  let audioOrder = 0;

  for (const scene of inputs) {
    if (!Number.isFinite(scene.durationSeconds) || scene.durationSeconds <= 0) continue;
    const imageIds = [...new Set(scene.imageIds.filter(Boolean))];
    const duration = scene.durationSeconds;
    imageIds.forEach((assetId, index) => {
      const start = cursor + duration * index / imageIds.length;
      const end = cursor + duration * (index + 1) / imageIds.length;
      clips.push({
        id: makeId(),
        track: "images",
        sceneId: scene.sceneId,
        assetId,
        startSeconds: start,
        durationSeconds: end - start,
        order: imageOrder++,
      });
    });
    clips.push({
      id: makeId(),
      track: "audio",
      sceneId: scene.sceneId,
      startSeconds: cursor,
      durationSeconds: duration,
      order: audioOrder++,
    });
    cursor += duration;
  }
  return clips;
}

export function moveTimelineClip(
  clips: TimelineClip[],
  clipId: string,
  direction: -1 | 1,
): TimelineClip[] {
  const clip = clips.find((item) => item.id === clipId);
  if (!clip) return clips;
  const peers = clips.filter((item) => item.track === clip.track).sort((a, b) => a.order - b.order);
  const index = peers.findIndex((item) => item.id === clipId);
  const target = index + direction;
  if (target < 0 || target >= peers.length) return clips;
  [peers[index], peers[target]] = [peers[target], peers[index]];
  const orders = new Map(peers.map((item, itemIndex) => [item.id, itemIndex]));
  return clips.map((item) => orders.has(item.id) ? { ...item, order: orders.get(item.id)! } : item);
}

export function timelineDurationSeconds(clips: TimelineClip[]): number {
  return clips.reduce(
    (maximum, clip) => Math.max(maximum, clip.startSeconds + clip.durationSeconds),
    0,
  );
}

export function imageClipAtTime(clips: TimelineClip[], timeSeconds: number): TimelineClip | undefined {
  if (!Number.isFinite(timeSeconds) || timeSeconds < 0) return undefined;
  const matches = clips
    .filter((clip) => clip.track === "images"
      && timeSeconds >= clip.startSeconds
      && timeSeconds < clip.startSeconds + clip.durationSeconds)
    .sort((left, right) => left.startSeconds - right.startSeconds || left.order - right.order);
  return matches[matches.length - 1];
}

/** Assign an ordered image sequence to scenes in balanced, contiguous batches. */
export function distributeImagesAcrossScenes<T extends { id: string; order: number }>(
  assets: T[],
  sceneIds: string[],
): SceneImageMapping[] {
  if (!assets.length || !sceneIds.length) return [];
  const ordered = [...assets].sort((left, right) => left.order - right.order);
  const buckets = sceneIds.map(() => [] as string[]);
  ordered.forEach((asset, index) => {
    const sceneIndex = Math.min(sceneIds.length - 1, Math.floor(index * sceneIds.length / ordered.length));
    buckets[sceneIndex].push(asset.id);
  });
  return sceneIds.map((sceneId, index) => ({ sceneId, imageIds: buckets[index] }));
}


/**
 * Resize one image clip while keeping its scene's image track exactly aligned
 * to the measured audio duration. The other image clips in that scene share
 * the remaining time in proportion to their previous durations.
 */
export function resizeImageClipKeepingSceneDuration(
  clips: TimelineClip[],
  clipId: string,
  requestedDurationSeconds: number,
): TimelineClip[] {
  const target = clips.find((clip) => clip.id === clipId && clip.track === "images");
  if (!target || !Number.isFinite(requestedDurationSeconds) || requestedDurationSeconds <= 0) return clips;

  const sceneImages = clips
    .filter((clip) => clip.track === "images" && clip.sceneId === target.sceneId)
    .sort((left, right) => left.order - right.order || left.startSeconds - right.startSeconds);
  if (sceneImages.length < 2) return clips;

  const audioClip = clips.find((clip) => clip.track === "audio" && clip.sceneId === target.sceneId);
  const sceneStart = audioClip?.startSeconds ?? Math.min(...sceneImages.map((clip) => clip.startSeconds));
  const sceneDuration = audioClip?.durationSeconds
    ?? sceneImages.reduce((total, clip) => total + clip.durationSeconds, 0);
  const minimum = 0.01;
  const nextTargetDuration = Math.min(sceneDuration - minimum * (sceneImages.length - 1), Math.max(minimum, requestedDurationSeconds));
  if (!Number.isFinite(sceneDuration) || sceneDuration <= minimum * sceneImages.length
    || nextTargetDuration < minimum) return clips;

  const remaining = sceneImages.filter((clip) => clip.id !== clipId);
  const previousRemainingTotal = remaining.reduce((total, clip) => total + clip.durationSeconds, 0);
  const remainingTime = sceneDuration - nextTargetDuration;
  const durations = new Map<string, number>([[clipId, nextTargetDuration]]);
  let allocated = 0;
  remaining.forEach((clip, index) => {
    const duration = index === remaining.length - 1
      ? remainingTime - allocated
      : previousRemainingTotal > 0
        ? remainingTime * (clip.durationSeconds / previousRemainingTotal)
        : remainingTime / remaining.length;
    durations.set(clip.id, duration);
    allocated += duration;
  });

  let cursor = sceneStart;
  const updated = new Map<string, TimelineClip>();
  for (const clip of sceneImages) {
    const duration = durations.get(clip.id) ?? clip.durationSeconds;
    updated.set(clip.id, { ...clip, startSeconds: cursor, durationSeconds: duration });
    cursor += duration;
  }
  return clips.map((clip) => updated.get(clip.id) ?? clip);
}

/**
 * Apply one target hold duration to every image in the timeline. In each scene,
 * all images except the last receive that exact duration; the final image fills
 * the remaining measured scene audio so there are no black gaps or uncovered
 * audio tails. Returns null if the requested duration cannot fit a scene.
 */
export function setAllImageClipDurations(
  clips: TimelineClip[],
  requestedDurationSeconds: number,
): TimelineClip[] | null {
  if (!Number.isFinite(requestedDurationSeconds) || requestedDurationSeconds <= 0) return null;
  const sceneIds = [...new Set(clips.filter((clip) => clip.track === "images").map((clip) => clip.sceneId))];
  const duration = requestedDurationSeconds;
  const replacements = new Map<string, TimelineClip>();

  for (const sceneId of sceneIds) {
    const images = clips
      .filter((clip) => clip.track === "images" && clip.sceneId === sceneId)
      .sort((left, right) => left.order - right.order || left.startSeconds - right.startSeconds);
    if (!images.length) continue;
    const audioClip = clips.find((clip) => clip.track === "audio" && clip.sceneId === sceneId);
    const sceneStart = audioClip?.startSeconds ?? images[0].startSeconds;
    const sceneDuration = audioClip?.durationSeconds ?? images.reduce((total, clip) => total + clip.durationSeconds, 0);
    const remainder = sceneDuration - duration * (images.length - 1);
    if (!Number.isFinite(sceneDuration) || sceneDuration <= 0 || remainder < 0.01) return null;

    let cursor = sceneStart;
    images.forEach((clip, index) => {
      const clipDuration = index === images.length - 1 ? remainder : duration;
      replacements.set(clip.id, { ...clip, startSeconds: cursor, durationSeconds: clipDuration });
      cursor += clipDuration;
    });
  }

  return clips.map((clip) => replacements.get(clip.id) ?? clip);
}

/** Split an image clip at the current playhead without changing total scene coverage. */
export function splitImageClipAtTime(
  clips: TimelineClip[],
  clipId: string,
  playheadSeconds: number,
  makeId: () => string = () => crypto.randomUUID(),
): TimelineClip[] {
  const target = clips.find((clip) => clip.id === clipId && clip.track === "images");
  if (!target || !Number.isFinite(playheadSeconds)) return clips;
  const end = target.startSeconds + target.durationSeconds;
  if (playheadSeconds <= target.startSeconds + 0.01 || playheadSeconds >= end - 0.01) return clips;

  const firstDuration = playheadSeconds - target.startSeconds;
  const second: TimelineClip = {
    ...target,
    id: makeId(),
    startSeconds: playheadSeconds,
    durationSeconds: end - playheadSeconds,
    order: target.order + 0.5,
  };
  const first: TimelineClip = { ...target, durationSeconds: firstDuration };
  return clips.map((clip) => clip.id === clipId ? first : clip).concat(second);
}


export type SceneAudioTimingInput = { sceneId: string; durationSeconds: number };

/**
 * Build one continuous, evenly distributed image sequence over the complete
 * measured audio runtime. For example, 600 seconds and 20 images produces
 * 20 consecutive 30-second clips, with the final endpoint fixed to audio end.
 */
export function buildEvenTimeline(
  audioInputs: SceneAudioTimingInput[],
  imageIds: string[],
  makeId: () => string = () => crypto.randomUUID(),
): TimelineClip[] {
  let cursor = 0;
  let audioOrder = 0;
  const audioRanges: Array<{ sceneId: string; start: number; end: number }> = [];
  const clips: TimelineClip[] = [];

  for (const input of audioInputs) {
    if (!input.sceneId || !Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0) continue;
    const start = cursor;
    const end = start + input.durationSeconds;
    audioRanges.push({ sceneId: input.sceneId, start, end });
    clips.push({
      id: makeId(),
      track: "audio",
      sceneId: input.sceneId,
      startSeconds: start,
      durationSeconds: input.durationSeconds,
      order: audioOrder++,
    });
    cursor = end;
  }

  const orderedImages = [...new Set(imageIds.filter((id) => typeof id === "string" && id.length > 0))];
  if (cursor <= 0 || !orderedImages.length) return clips;

  const imageDuration = cursor / orderedImages.length;
  orderedImages.forEach((assetId, index) => {
    const start = imageDuration * index;
    const end = index === orderedImages.length - 1 ? cursor : imageDuration * (index + 1);
    const midpoint = start + (end - start) / 2;
    const scene = audioRanges.find((range) => midpoint >= range.start && midpoint < range.end)
      ?? audioRanges[audioRanges.length - 1];
    clips.push({
      id: makeId(),
      track: "images",
      sceneId: scene.sceneId,
      assetId,
      startSeconds: start,
      durationSeconds: end - start,
      order: index,
    });
  });

  return clips;
}

function fullTimelineRange(clips: TimelineClip[]): { start: number; end: number } | null {
  const audioClips = clips.filter((clip) => clip.track === "audio");
  const reference = audioClips.length ? audioClips : clips.filter((clip) => clip.track === "images");
  if (!reference.length) return null;
  return {
    start: Math.min(...reference.map((clip) => clip.startSeconds)),
    end: Math.max(...reference.map((clip) => clip.startSeconds + clip.durationSeconds)),
  };
}

/** Ripple-resize one image and proportionally redistribute all remaining images
 * so the image sequence still spans the complete audio timeline without gaps. */
export function resizeImageClipKeepingTimelineDuration(
  clips: TimelineClip[],
  clipId: string,
  requestedDurationSeconds: number,
): TimelineClip[] {
  const target = clips.find((clip) => clip.id === clipId && clip.track === "images");
  const images = clips.filter((clip) => clip.track === "images")
    .sort((left, right) => left.startSeconds - right.startSeconds || left.order - right.order);
  const range = fullTimelineRange(clips);
  if (!target || !range || !Number.isFinite(requestedDurationSeconds) || requestedDurationSeconds <= 0) return clips;
  if (images.length === 1) {
    return clips.map((clip) => clip.id === clipId
      ? { ...clip, startSeconds: range.start, durationSeconds: range.end - range.start }
      : clip);
  }

  const totalDuration = range.end - range.start;
  const minimum = 0.01;
  if (!Number.isFinite(totalDuration) || totalDuration <= minimum * images.length) return clips;
  const targetDuration = Math.min(
    totalDuration - minimum * (images.length - 1),
    Math.max(minimum, requestedDurationSeconds),
  );
  const remaining = images.filter((clip) => clip.id !== clipId);
  const previousTotal = remaining.reduce((sum, clip) => sum + clip.durationSeconds, 0);
  const available = totalDuration - targetDuration;
  const durations = new Map<string, number>([[clipId, targetDuration]]);
  let allocated = 0;

  remaining.forEach((clip, index) => {
    const duration = index === remaining.length - 1
      ? available - allocated
      : previousTotal > 0
        ? available * clip.durationSeconds / previousTotal
        : available / remaining.length;
    durations.set(clip.id, duration);
    allocated += duration;
  });

  let cursor = range.start;
  const updates = new Map<string, TimelineClip>();
  images.forEach((clip) => {
    const duration = durations.get(clip.id) ?? clip.durationSeconds;
    updates.set(clip.id, { ...clip, startSeconds: cursor, durationSeconds: duration });
    cursor += duration;
  });
  return clips.map((clip) => updates.get(clip.id) ?? clip);
}

/** Apply a common hold duration to the whole image sequence; the final image
 * fills the remaining measured audio duration exactly. */
export function setAllImageClipDurationsAcrossTimeline(
  clips: TimelineClip[],
  requestedDurationSeconds: number,
): TimelineClip[] | null {
  if (!Number.isFinite(requestedDurationSeconds) || requestedDurationSeconds <= 0) return null;
  const images = clips.filter((clip) => clip.track === "images")
    .sort((left, right) => left.startSeconds - right.startSeconds || left.order - right.order);
  const range = fullTimelineRange(clips);
  if (!range || !images.length) return null;

  const totalDuration = range.end - range.start;
  const finalDuration = totalDuration - requestedDurationSeconds * (images.length - 1);
  if (!Number.isFinite(totalDuration) || totalDuration <= 0 || finalDuration < 0.01) return null;

  let cursor = range.start;
  const updates = new Map<string, TimelineClip>();
  images.forEach((clip, index) => {
    const duration = index === images.length - 1 ? finalDuration : requestedDurationSeconds;
    updates.set(clip.id, { ...clip, startSeconds: cursor, durationSeconds: duration });
    cursor += duration;
  });
  return clips.map((clip) => updates.get(clip.id) ?? clip);
}
