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


export type MotionPreviewClipTiming = {
  index: number;
  startSeconds: number;
  durationSeconds: number;
  transitionDurationSeconds: number;
};

export type MotionPreviewFrameState =
  | { kind: "clip"; currentIndex: number; progress: number }
  | {
      kind: "transition";
      outgoingIndex: number;
      incomingIndex: number;
      outgoingProgress: number;
      incomingProgress: number;
      progress: number;
    };

function clampPreview(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Mirrors the sequential xfade offsets used by local-render/server.py.
 * Transition time is taken from the rendered sequence rather than added to it,
 * and the renderer pads the final frame so total duration remains unchanged.
 */
export function buildMotionPreviewSchedule(
  durations: number[],
  transition: "cut" | "fade" | "dissolve" | "wipe-left" | "wipe-right",
  requestedTransitionSeconds: number,
): MotionPreviewClipTiming[] {
  if (!durations.length) return [];
  if (durations.some((duration) => !Number.isFinite(duration) || duration <= 0)) {
    throw new Error("Every preview clip must have a finite duration greater than zero.");
  }
  let runningDuration = durations[0];
  const schedule: MotionPreviewClipTiming[] = [{
    index: 0,
    startSeconds: 0,
    durationSeconds: durations[0],
    transitionDurationSeconds: 0,
  }];
  for (let index = 1; index < durations.length; index += 1) {
    const duration = durations[index];
    const fade = transition === "cut"
      ? 0
      : clampPreview(requestedTransitionSeconds, 0.05, Math.min(5, duration / 2, runningDuration / 2));
    const startSeconds = Math.max(0, runningDuration - fade);
    schedule.push({
      index,
      startSeconds,
      durationSeconds: duration,
      transitionDurationSeconds: fade,
    });
    runningDuration += duration - fade;
  }
  return schedule;
}

/** Returns the clip(s) that should be composited for a given soundtrack time. */
export function getMotionPreviewFrameState(
  timeSeconds: number,
  schedule: MotionPreviewClipTiming[],
): MotionPreviewFrameState | null {
  if (!schedule.length) return null;
  const time = Math.max(0, Number.isFinite(timeSeconds) ? timeSeconds : 0);
  for (let index = schedule.length - 1; index > 0; index -= 1) {
    const incoming = schedule[index];
    const fade = incoming.transitionDurationSeconds;
    if (fade > 0 && time >= incoming.startSeconds && time < incoming.startSeconds + fade) {
      const outgoing = schedule[index - 1];
      return {
        kind: "transition",
        outgoingIndex: outgoing.index,
        incomingIndex: incoming.index,
        outgoingProgress: clampPreview((time - outgoing.startSeconds) / outgoing.durationSeconds, 0, 1),
        incomingProgress: clampPreview((time - incoming.startSeconds) / incoming.durationSeconds, 0, 1),
        progress: clampPreview((time - incoming.startSeconds) / fade, 0, 1),
      };
    }
  }

  let current = schedule[0];
  for (let index = 1; index < schedule.length; index += 1) {
    const candidate = schedule[index];
    const settledAt = candidate.startSeconds + candidate.transitionDurationSeconds;
    if (time >= settledAt) current = candidate;
    else break;
  }
  return {
    kind: "clip",
    currentIndex: current.index,
    progress: clampPreview((time - current.startSeconds) / current.durationSeconds, 0, 1),
  };
}
