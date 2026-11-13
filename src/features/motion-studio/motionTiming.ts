import type { ProjectTimelineClip } from "../../lib/projectStore";

/**
 * Distribute a complete soundtrack evenly across an ordered image sequence.
 * The final image absorbs the floating-point remainder so the image track
 * ends at the soundtrack boundary without an uncovered tail.
 */
export function buildEvenImageTimeline(
  assetIds: string[],
  audioDurationSeconds: number,
  sceneId: string,
  makeId: () => string = () => crypto.randomUUID(),
): ProjectTimelineClip[] {
  if (!assetIds.length) throw new Error("Add at least one image before building a timeline.");
  if (!sceneId.trim()) throw new Error("A scene ID is required to build the image timeline.");
  if (!Number.isFinite(audioDurationSeconds) || audioDurationSeconds <= 0 || audioDurationSeconds > 24 * 60 * 60) {
    throw new Error("The soundtrack duration must be greater than zero and no longer than 24 hours.");
  }
  if (assetIds.some((id) => typeof id !== "string" || !id.trim())) {
    throw new Error("Every image must have a valid asset ID.");
  }

  const equalDuration = audioDurationSeconds / assetIds.length;
  let cursor = 0;
  return assetIds.map((assetId, index) => {
    const durationSeconds = index === assetIds.length - 1
      ? audioDurationSeconds - cursor
      : equalDuration;
    const clip: ProjectTimelineClip = {
      id: makeId(),
      track: "images",
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

/** Move one sequence item to a target index without mutating the source array. */
export function moveSequenceItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)
      || fromIndex < 0 || fromIndex >= items.length || toIndex < 0 || toIndex >= items.length
      || fromIndex === toIndex) {
    return items;
  }
  const next = [...items];
  const [moving] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moving);
  return next;
}
