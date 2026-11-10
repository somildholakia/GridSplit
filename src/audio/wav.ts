export interface WavMetadata { sampleCount: number; sampleRate: number; channels: number; bitsPerSample: number; encoding: number }
function fourCC(view: DataView, offset: number): string {
  return String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
}
/** Read real sample-frame metadata from a RIFF/WAVE buffer without decoding samples. */
export function readWavMetadata(buffer: ArrayBuffer): WavMetadata {
  if (buffer.byteLength < 44) throw new Error("The local TTS engine returned an incomplete WAV file.");
  const view = new DataView(buffer);
  if (fourCC(view, 0) !== "RIFF" || fourCC(view, 8) !== "WAVE") throw new Error("The local TTS engine did not return a RIFF/WAVE audio file.");
  let offset = 12;
  let format: { encoding: number; channels: number; sampleRate: number; blockAlign: number; bitsPerSample: number } | null = null;
  let dataBytes: number | null = null;
  while (offset + 8 <= view.byteLength) {
    const name = fourCC(view, offset), size = view.getUint32(offset + 4, true), start = offset + 8, end = start + size;
    if (end > view.byteLength) throw new Error("The WAV file contains a truncated chunk.");
    if (name === "fmt ") {
      if (size < 16) throw new Error("The WAV format chunk is invalid.");
      format = { encoding: view.getUint16(start, true), channels: view.getUint16(start + 2, true),
        sampleRate: view.getUint32(start + 4, true), blockAlign: view.getUint16(start + 12, true),
        bitsPerSample: view.getUint16(start + 14, true) };
    } else if (name === "data" && dataBytes === null) dataBytes = size;
    offset = end + (size % 2);
  }
  if (!format || dataBytes === null) throw new Error("The WAV file is missing its format or sample data.");
  if (![1, 3].includes(format.encoding)) throw new Error("The WAV encoding is not supported for preview.");
  if (format.channels < 1 || format.channels > 8 || format.sampleRate < 1 || format.blockAlign < 1) throw new Error("The WAV audio metadata is invalid.");
  if (dataBytes % format.blockAlign !== 0) throw new Error("The WAV sample data is not frame-aligned.");
  const sampleCount = dataBytes / format.blockAlign;
  if (!Number.isSafeInteger(sampleCount) || sampleCount < 1) throw new Error("The WAV file contains no audio samples.");
  return { sampleCount, sampleRate: format.sampleRate, channels: format.channels, bitsPerSample: format.bitsPerSample, encoding: format.encoding };
}
