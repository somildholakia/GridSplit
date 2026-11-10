import { describe, expect, it } from "vitest";
import type { ParsedScene } from "./scriptParser";
import { ensureSpeakerCharacters, reconcileAudioSegments } from "./audioWorkflow";
import type { StudioAudioSegment, StudioCharacter } from "../audio/types";
const scenes: ParsedScene[] = [{ id: "scene-1", title: "Opening", chapter: "Chapter 1", sourceText: "", blocks: [
  { id: "n1", kind: "narration", text: "The city is quiet.", sourceLine: 1 },
  { id: "d1", kind: "dialogue", speaker: "MAYA", text: "Hello?", sourceLine: 2 },
  { id: "s1", kind: "sfx", cue: "THUNDER", text: "", sourceLine: 3 },
  { id: "m1", kind: "music", cue: "TENSION", text: "", sourceLine: 4 },
]}];
describe("audio workflow", () => {
  it("creates stable narrator and speaker records", () => {
    let id = 0; const first = ensureSpeakerCharacters(scenes, [], () => `character-${++id}`);
    expect(first.map((c) => c.name)).toEqual(["Narrator", "MAYA"]);
    expect(ensureSpeakerCharacters(scenes, first, () => "unexpected")).toEqual(first);
  });
  it("creates segments for narration/dialogue only", () => {
    const chars = ensureSpeakerCharacters(scenes, [], () => "id");
    const result = reconcileAudioSegments(scenes, chars, [], "2026-11-10T00:00:00.000Z");
    expect(result.map((s) => s.blockId)).toEqual(["n1", "d1"]);
    expect(result.every((s) => s.status === "pending")).toBe(true);
  });
  it("preserves ready output when text and voice remain unchanged", () => {
    const chars = ensureSpeakerCharacters(scenes, [], () => "id"), initial = reconcileAudioSegments(scenes, chars);
    const ready: StudioAudioSegment[] = initial.map((s) => ({ ...s, status: "ready", sampleCount: 48000, sampleRate: 24000, channels: 1, durationSeconds: 2 }));
    expect(reconcileAudioSegments(scenes, chars, ready)).toEqual(ready);
  });
  it("invalidates only a segment whose speaker voice changes", () => {
    const chars = ensureSpeakerCharacters(scenes, [], () => "id"), initial = reconcileAudioSegments(scenes, chars);
    const ready = initial.map((s) => ({ ...s, status: "ready" as const, sampleCount: 100 }));
    const changed: StudioCharacter[] = chars.map((c) => c.name === "MAYA" ? { ...c, voiceId: "af_bella" } : c);
    const next = reconcileAudioSegments(scenes, changed, ready);
    expect(next[1].status).toBe("pending"); expect(next[1].sampleCount).toBeUndefined(); expect(next[0].status).toBe("ready");
  });
});
