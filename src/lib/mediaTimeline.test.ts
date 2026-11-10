import { describe, expect, it } from "vitest";
import { buildSynchronizationMetadata, measureWavBlob, toSrt, toVtt } from "./mediaTimeline";

const segments = [
  { id: "a", sceneId: "scene-1", blockId: "block-1", text: "Hello there.", speaker: "Maya", sampleCount: 24_000, sampleRate: 24_000 },
  { id: "b", sceneId: "scene-1", blockId: "block-2", text: "Welcome back.", sampleCount: 48_000, sampleRate: 48_000 },
  { id: "c", sceneId: "scene-2", blockId: "block-3", text: "The end.", sampleCount: 12_000, sampleRate: 24_000 },
];

function wavFixture(samples = 24_000, rate = 24_000, channels = 1): ArrayBuffer {
  const align = channels * 2, bytes = samples * align, buffer = new ArrayBuffer(44 + bytes), view = new DataView(buffer);
  const write = (offset: number, value: string) => { for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i)); };
  write(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true); write(8, "WAVE"); write(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * align, true); view.setUint16(32, align, true); view.setUint16(34, 16, true);
  write(36, "data"); view.setUint32(40, bytes, true); return buffer;
}

describe("sample-accurate media timeline", () => {
  it("remeasures a WAV Blob from its actual sample frames", async () => {
    const measured = await measureWavBlob(new Blob([wavFixture(48_000, 24_000, 2)]));
    expect(measured).toMatchObject({ sampleCount: 48_000, sampleRate: 24_000, channels: 2, durationSeconds: 2, duration: { numerator: "2", denominator: "1" } });
  });

  it("measures and accumulates exact durations across sample rates", () => {
    const result = buildSynchronizationMetadata(segments);
    expect(result.segments.map((item) => [item.start, item.end])).toEqual([
      [{ numerator: "0", denominator: "1" }, { numerator: "1", denominator: "1" }],
      [{ numerator: "1", denominator: "1" }, { numerator: "2", denominator: "1" }],
      [{ numerator: "2", denominator: "1" }, { numerator: "5", denominator: "2" }],
    ]);
    expect(result.totalDuration).toEqual({ numerator: "5", denominator: "2" });
    expect(result.totalDurationSeconds).toBe(2.5);
    expect(result.scenes.map((scene) => scene.segmentIds)).toEqual([["a", "b"], ["c"]]);
  });

  it("exports deterministic segment-level SRT and VTT cues", () => {
    const result = buildSynchronizationMetadata(segments);
    expect(toSrt(result)).toContain("00:00:00,000 --> 00:00:01,000\nMaya: Hello there.");
    expect(toVtt(result)).toContain("WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nMaya: Hello there.");
  });

  it("rejects invalid sample metadata and duplicate IDs", () => {
    expect(() => buildSynchronizationMetadata([{ ...segments[0], sampleRate: 0 }])).toThrow(/positive sample count/);
    expect(() => buildSynchronizationMetadata([segments[0], segments[0]])).toThrow(/unique/);
  });

  it("keeps subtitle cue numbering contiguous when empty segments are skipped", () => {
    const result = buildSynchronizationMetadata([segments[0], { ...segments[1], id: "empty", text: "" }, segments[2]]);
    const cues = toSrt(result).split("\n\n");
    expect(cues[0].startsWith("1\n")).toBe(true);
    expect(cues[1].startsWith("2\n")).toBe(true);
  });

  it("does not invent a cue for empty text", () => {
    const result = buildSynchronizationMetadata([{ ...segments[0], text: "  " }]);
    expect(toSrt(result)).toBe("");
    expect(toVtt(result)).toBe("WEBVTT\n\n");
  });
});
