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
  const match = stem.match(/(\d+)(?=\D*$)/);
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
