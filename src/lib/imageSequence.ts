export interface ImageSequenceAsset {
  id: string;
  fileName: string;
  relativePath: string;
  mimeType: string;
  sizeBytes: number;
  sequenceNumber: number | null;
  fingerprint: string;
  width?: number;
  height?: number;
}

export interface SceneImageMapping {
  sceneId: string;
  imageIds: string[];
}

export function sequenceNumberFromName(name: string): number | null {
  const base = name.split(/[\\/]/).pop() ?? name;
  const stem = base.replace(/\.[^.]+$/, "");
  const match = stem.match(/(?:^|\D)(\d{1,8})(?=\D*$)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : null;
}

/** Return at most 100 missing values to keep pathological filenames cheap to inspect. */
export function findSequenceGaps(images: ImageSequenceAsset[]): number[] {
  const numbers = [...new Set(images
    .map((image) => image.sequenceNumber)
    .filter((value): value is number => Number.isSafeInteger(value) && (value as number) >= 0))]
    .sort((left, right) => left - right);
  const gaps: number[] = [];
  for (let index = 1; index < numbers.length && gaps.length < 100; index += 1) {
    for (let candidate = numbers[index - 1] + 1; candidate < numbers[index] && gaps.length < 100; candidate += 1) {
      gaps.push(candidate);
    }
  }
  return gaps;
}

/** Fingerprints are review candidates, never an automatic deletion decision. */
export function findDuplicateImageGroups(images: ImageSequenceAsset[]): ImageSequenceAsset[][] {
  const groups = new Map<string, ImageSequenceAsset[]>();
  for (const image of images) {
    if (!image.fingerprint) continue;
    const group = groups.get(image.fingerprint) ?? [];
    group.push(image);
    groups.set(image.fingerprint, group);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

export function moveImageSequenceItem(
  images: ImageSequenceAsset[],
  imageId: string,
  direction: -1 | 1,
): ImageSequenceAsset[] {
  const index = images.findIndex((image) => image.id === imageId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= images.length) return images;
  const next = [...images];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function renumberImageSequence(images: ImageSequenceAsset[]): ImageSequenceAsset[] {
  return images.map((image, index) => ({ ...image, sequenceNumber: index + 1 }));
}

export function isImageSequenceAsset(value: unknown): value is ImageSequenceAsset {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string"
    && typeof item.fileName === "string"
    && typeof item.relativePath === "string"
    && typeof item.mimeType === "string"
    && typeof item.sizeBytes === "number"
    && Number.isSafeInteger(item.sizeBytes)
    && item.sizeBytes >= 0
    && (item.sequenceNumber === null || (typeof item.sequenceNumber === "number" && Number.isSafeInteger(item.sequenceNumber)))
    && typeof item.fingerprint === "string"
    && (item.width === undefined || (typeof item.width === "number" && Number.isFinite(item.width) && item.width > 0))
    && (item.height === undefined || (typeof item.height === "number" && Number.isFinite(item.height) && item.height > 0));
}

export function isSceneImageMapping(value: unknown): value is SceneImageMapping {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.sceneId === "string"
    && Array.isArray(item.imageIds)
    && item.imageIds.every((id) => typeof id === "string")
    && new Set(item.imageIds).size === item.imageIds.length;
}
