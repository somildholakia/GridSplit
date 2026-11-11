import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIMELINE_PIXELS_PER_SECOND,
  IMAGE_PAGE_SIZE,
  MAX_PROJECT_IMAGES,
  buildRulerTicks,
  formatTimelineTime,
  timelinePixelsPerSecond,
} from "./capacity";

describe("browser-first project capacity", () => {
  it("supports more than 1,200 images and renders image galleries in bounded pages", () => {
    expect(MAX_PROJECT_IMAGES).toBeGreaterThanOrEqual(1_200);
    expect(IMAGE_PAGE_SIZE).toBeLessThanOrEqual(100);
    expect(MAX_PROJECT_IMAGES / IMAGE_PAGE_SIZE).toBeGreaterThanOrEqual(20);
  });

  it("keeps the timeline scale bounded for one-hour and longer projects", () => {
    expect(timelinePixelsPerSecond(3_600)).toBeLessThan(DEFAULT_TIMELINE_PIXELS_PER_SECOND);
    expect(timelinePixelsPerSecond(3_600) * 3_600).toBeLessThanOrEqual(120_000);
    expect(timelinePixelsPerSecond(7_200) * 7_200).toBeLessThanOrEqual(120_000);
  });

  it("uses a bounded adaptive ruler for one-hour timelines", () => {
    const ticks = buildRulerTicks(3_600);
    expect(ticks.length).toBeLessThanOrEqual(241);
    expect(ticks[0]).toBe(0);
    expect(ticks.at(-1)).toBe(3_600);
  });

  it("keeps hour information in displayed timeline labels", () => {
    expect(formatTimelineTime(3_600)).toBe("1:00:00.0");
    expect(formatTimelineTime(5_432.5)).toBe("1:30:32.5");
    expect(formatTimelineTime(90)).toBe("1:30.0");
  });
});
