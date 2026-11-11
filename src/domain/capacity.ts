/**
 * Browser-first capacity defaults for GridSplit projects.
 *
 * The image count is a product limit, not a promise that every device has
 * enough free storage for 2,400 full-resolution originals. Import checks the
 * browser's reported quota and stores assets incrementally.
 */
export const MAX_PROJECT_IMAGES = 2_400;
export const IMAGE_PAGE_SIZE = 60;
export const MAX_IMAGE_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_TIMELINE_WIDTH = 120_000;
export const DEFAULT_TIMELINE_PIXELS_PER_SECOND = 64;

export function timelinePixelsPerSecond(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return DEFAULT_TIMELINE_PIXELS_PER_SECOND;
  }
  return Math.min(DEFAULT_TIMELINE_PIXELS_PER_SECOND, MAX_TIMELINE_WIDTH / durationSeconds);
}

export function rulerIntervalSeconds(durationSeconds: number, maxTicks = 240): number {
  const duration = Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0;
  const base = duration <= 600 ? 5
    : duration <= 1_800 ? 15
      : duration <= 3_600 ? 30
        : duration <= 10_800 ? 60 : 300;
  if (duration === 0) return base;
  return Math.max(base, Math.ceil((duration / Math.max(2, maxTicks)) / base) * base);
}

export function buildRulerTicks(durationSeconds: number, maxTicks = 240): number[] {
  const duration = Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0;
  if (duration === 0) return [0];
  const interval = rulerIntervalSeconds(duration, maxTicks);
  const count = Math.min(maxTicks, Math.floor(duration / interval) + 1);
  const ticks = Array.from({ length: count }, (_, index) => index * interval);
  if (ticks[ticks.length - 1] !== duration) ticks.push(duration);
  return ticks;
}

export function formatTimelineTime(value: number): string {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
  const hours = Math.floor(safe / 3_600);
  const minutes = Math.floor((safe % 3_600) / 60);
  const seconds = (safe % 60).toFixed(1).padStart(4, "0");
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}
