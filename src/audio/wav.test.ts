import { describe, expect, it } from "vitest";
import { readWavMetadata } from "./wav";
function wavFixture(samples = 100, rate = 24000, channels = 1): ArrayBuffer {
  const align = channels * 2, bytes = samples * align, buffer = new ArrayBuffer(44 + bytes), view = new DataView(buffer);
  const write = (offset: number, value: string) => { for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i)); };
  write(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true); write(8, "WAVE"); write(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * align, true); view.setUint16(32, align, true); view.setUint16(34, 16, true);
  write(36, "data"); view.setUint32(40, bytes, true); return buffer;
}
describe("WAV metadata", () => {
  it("measures sample count, sample rate and channels", () => expect(readWavMetadata(wavFixture(1200, 48000, 2))).toMatchObject({ sampleCount: 1200, sampleRate: 48000, channels: 2, bitsPerSample: 16, encoding: 1 }));
  it("rejects non-WAV and truncated files", () => {
    expect(() => readWavMetadata(new ArrayBuffer(12))).toThrow(/incomplete WAV/);
    const invalid = wavFixture(); new DataView(invalid).setUint32(40, invalid.byteLength, true);
    expect(() => readWavMetadata(invalid)).toThrow(/truncated chunk/);
  });
  it("rejects files without audio sample frames", () => expect(() => readWavMetadata(wavFixture(0))).toThrow(/no audio samples/));
});
