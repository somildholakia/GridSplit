import { describe, expect, it } from "vitest";
import { parseGridCoordinatePayload } from "./gridCoordinateImport";

const IMAGE_WIDTH = 1000;
const IMAGE_HEIGHT = 600;

describe("bulk grid coordinate import", () => {
  it("sorts pixel coordinates and keeps each row's vertical cuts independent", () => {
    const parsed = parseGridCoordinatePayload(
      JSON.stringify({
        width: IMAGE_WIDTH,
        height: IMAGE_HEIGHT,
        horizontalCuts: [400, 200],
        verticalCutsByRow: [[700, 100], [300], []],
      }),
      IMAGE_WIDTH,
      IMAGE_HEIGHT,
    );

    expect(parsed.horizontalCuts).toEqual([200, 400]);
    expect(parsed.verticalCutsByRow).toEqual([[100, 700], [300], []]);
  });

  it("accepts a complete JSON object copied inside a markdown code fence", () => {
    const fence = String.fromCharCode(96).repeat(3);
    const fencedJson = [
      fence + "json",
      "{",
      '  "width": 1000,',
      '  "height": 600,',
      '  "horizontalCuts": [300],',
      '  "verticalCutsByRow": [[250], [500]]',
      "}",
      fence,
    ].join("\n");
    const parsed = parseGridCoordinatePayload(fencedJson, IMAGE_WIDTH, IMAGE_HEIGHT);

    expect(parsed.verticalCutsByRow).toEqual([[250], [500]]);
    expect(parsed.horizontalCuts).toEqual([300]);
  });

  it("scales pixel coordinates when the uploaded image has the same aspect ratio", () => {
    const parsed = parseGridCoordinatePayload(
      JSON.stringify({
        width: 1000,
        height: 600,
        horizontalCuts: [300],
        verticalCutsByRow: [[250], [500]],
      }),
      2000,
      1200,
    );

    expect(parsed.width).toBe(2000);
    expect(parsed.height).toBe(1200);
    expect(parsed.horizontalCuts).toEqual([600]);
    expect(parsed.verticalCutsByRow).toEqual([[500], [1000]]);
  });

  it("rejects coordinates when the uploaded image has a different aspect ratio", () => {
    expect(() => parseGridCoordinatePayload(
      JSON.stringify({
        width: 1000,
        height: 600,
        horizontalCuts: [],
        verticalCutsByRow: [[]],
      }),
      1000,
      700,
    )).toThrow(/aspect ratio mismatch/i);
  });

  it("rejects scaled coordinates that collapse into duplicate lines", () => {
    expect(() => parseGridCoordinatePayload(
      JSON.stringify({
        width: 1000,
        height: 600,
        horizontalCuts: [],
        verticalCutsByRow: [[200, 201]],
      }),
      100,
      60,
    )).toThrow(/duplicate lines/i);
  });

  it("requires one vertical array for each horizontal row", () => {
    expect(() => parseGridCoordinatePayload(
      JSON.stringify({
        width: IMAGE_WIDTH,
        height: IMAGE_HEIGHT,
        horizontalCuts: [200, 400],
        verticalCutsByRow: [[100], [200]],
      }),
      IMAGE_WIDTH,
      IMAGE_HEIGHT,
    )).toThrow(/Row count mismatch/);
  });

  it("rejects duplicate and out-of-bounds cuts instead of silently moving them", () => {
    const duplicate = {
      width: IMAGE_WIDTH,
      height: IMAGE_HEIGHT,
      horizontalCuts: [],
      verticalCutsByRow: [[200, 200]],
    };
    expect(() => parseGridCoordinatePayload(JSON.stringify(duplicate), IMAGE_WIDTH, IMAGE_HEIGHT))
      .toThrow(/duplicate pixel coordinates/);

    const outside = {
      width: IMAGE_WIDTH,
      height: IMAGE_HEIGHT,
      horizontalCuts: [600],
      verticalCutsByRow: [[], []],
    };
    expect(() => parseGridCoordinatePayload(JSON.stringify(outside), IMAGE_WIDTH, IMAGE_HEIGHT))
      .toThrow(/outside the image/);
  });

  it("supports rows with no vertical cuts", () => {
    const parsed = parseGridCoordinatePayload(
      JSON.stringify({
        width: IMAGE_WIDTH,
        height: IMAGE_HEIGHT,
        horizontalCuts: [300],
        verticalCutsByRow: [[], [500]],
      }),
      IMAGE_WIDTH,
      IMAGE_HEIGHT,
    );

    expect(parsed.verticalCutsByRow).toEqual([[], [500]]);
  });
});
