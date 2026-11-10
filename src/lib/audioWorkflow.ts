import type { ParsedScene } from "./scriptParser";
import { DEFAULT_LANGUAGE, DEFAULT_SPEECH_SPEED, DEFAULT_VOICE_ID, type StudioAudioSegment, type StudioCharacter } from "../audio/types";
const normalizeName = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
export function ensureSpeakerCharacters(scenes: ParsedScene[], current: StudioCharacter[] = [], makeId: () => string = () => crypto.randomUUID()): StudioCharacter[] {
  const characters = current.filter((c) => c && typeof c.id === "string" && typeof c.name === "string").map((c) => ({ ...c }));
  const byName = new Map(characters.map((c) => [normalizeName(c.name), c]));
  const required: Array<{ name: string; narrator: boolean }> = [];
  if (scenes.some((scene) => scene.blocks.some((block) => block.kind === "narration"))) required.push({ name: "Narrator", narrator: true });
  for (const scene of scenes) for (const block of scene.blocks) {
    if (block.kind !== "dialogue") continue;
    const name = block.speaker?.trim() || "Unknown speaker";
    if (!byName.has(normalizeName(name)) && !required.some((item) => normalizeName(item.name) === normalizeName(name))) required.push({ name, narrator: false });
  }
  for (const item of required) {
    const key = normalizeName(item.name);
    if (byName.has(key)) continue;
    const character: StudioCharacter = { id: makeId(), name: item.name, voiceId: DEFAULT_VOICE_ID,
      language: DEFAULT_LANGUAGE, speed: DEFAULT_SPEECH_SPEED, ...(item.narrator ? { narrator: true } : {}) };
    characters.push(character); byName.set(key, character);
  }
  return characters;
}
export function fingerprintSpeech(text: string, voiceId: string, language: string, speed: number): string {
  const value = `${text.trim()}\u0000${voiceId}\u0000${language}\u0000${speed}`;
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
export function reconcileAudioSegments(scenes: ParsedScene[], characters: StudioCharacter[], existing: StudioAudioSegment[] = [], now = new Date().toISOString()): StudioAudioSegment[] {
  const current = new Map(existing.map((segment) => [segment.id, segment]));
  const narrator = characters.find((c) => c.narrator || normalizeName(c.name) === "narrator");
  const output: StudioAudioSegment[] = [];
  for (const scene of scenes) for (const block of scene.blocks) {
    if (block.kind !== "narration" && block.kind !== "dialogue") continue;
    const character = block.kind === "narration" ? narrator
      : characters.find((c) => normalizeName(c.name) === normalizeName(block.speaker ?? "Unknown speaker"));
    const voiceId = character?.voiceId || DEFAULT_VOICE_ID, language = character?.language || DEFAULT_LANGUAGE;
    const speed = character?.speed || DEFAULT_SPEECH_SPEED, id = `segment:${scene.id}:${block.id}`;
    const fingerprint = fingerprintSpeech(block.text, voiceId, language, speed), previous = current.get(id);
    if (previous?.fingerprint === fingerprint) output.push(previous);
    else output.push({ id, sceneId: scene.id, blockId: block.id, fingerprint, status: "pending",
      providerId: "kokoro-local", voiceId, language, speed, updatedAt: now });
  }
  return output;
}
export function updateAudioSegment(segments: StudioAudioSegment[], segmentId: string, patch: Partial<StudioAudioSegment>, now = new Date().toISOString()): StudioAudioSegment[] {
  return segments.map((segment) => segment.id === segmentId ? { ...segment, ...patch, id: segment.id, updatedAt: now } : segment);
}
