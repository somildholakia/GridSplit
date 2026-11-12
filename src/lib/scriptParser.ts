export type BlockKind = "narration" | "dialogue" | "sfx" | "music";
export type ParsedBlock = { id: string; kind: BlockKind; text: string; speaker?: string; cue?: string; sourceLine: number };
export type ParsedScene = { id: string; title: string; chapter: string; blocks: ParsedBlock[]; sourceText: string };

const chapterHeading = /^(?:chapter|part)\s+\d+\b.*$/i;
const sceneHeading = /^(?:scene|sequence)\s+\d+\b.*$/i;

type Classification = Pick<ParsedBlock, "kind" | "text"> & Partial<Pick<ParsedBlock, "speaker" | "cue">>;

function classifyParagraph(raw: string): Classification {
  const trimmed = raw.trim().replace(/^\\*{1,2}(.*?)\\*{1,2}\\s*/, "$1 ");
  const bracket = trimmed.match(/^\[([^\]]+)\]\s*([\s\S]*)$/);
  const label = (bracket?.[1] ?? "").trim();
  const body = (bracket?.[2] ?? "").trim();
  const value = bracket ? label : trimmed;

  const character = value.match(/^(?:CHARACTER|CHAR|DIALOGUE)\s*:\s*(.+)$/i);
  if (character) return { kind: "dialogue", speaker: character[1].trim(), text: body };

  const narrator = value.match(/^(?:NARRATOR|NARRATION|VOICE\s*OVER|VOICEOVER|VO)\s*(?::|[-–—])?\s*([\s\S]*)$/i);
  if (narrator && (bracket || /^(?:NARRATOR|NARRATION|VOICE\s*OVER|VOICEOVER|VO)\s*(?::|[-–—])/i.test(trimmed))) {
    return { kind: "narration", text: bracket ? body : narrator[1].trim() };
  }

  const music = value.match(/^(?:BACKGROUND\s+MUSIC|MUSIC|BGM|SCORE)(?:\s+(?:CUE|TRACK))?\s*(?::|[-–—])?\s*([\s\S]*)$/i);
  if (music && (bracket || /^(?:BACKGROUND\s+MUSIC|MUSIC|BGM|SCORE)(?:\s+(?:CUE|TRACK))?\s*(?::|[-–—])/i.test(trimmed))) {
    const description = bracket ? body : music[1].trim();
    return { kind: "music", cue: label || "Music", text: description };
  }

  const sfx = value.match(/^(?:SOUND\s+EFFECTS?|SOUND\s+FX|SFX|FX|FOLEY|AMBIENCE|AMBIENT\s+SOUND)(?:\s+(?:CUE|TRACK))?\s*(?::|[-–—])?\s*([\s\S]*)$/i);
  if (sfx && (bracket || /^(?:SOUND\s+EFFECTS?|SOUND\s+FX|SFX|FX|FOLEY|AMBIENCE|AMBIENT\s+SOUND)(?:\s+(?:CUE|TRACK))?\s*(?::|[-–—])/i.test(trimmed))) {
    const description = bracket ? body : sfx[1].trim();
    return { kind: "sfx", cue: label || "Sound effect", text: description };
  }

  if (bracket) {
    if (/^(?:MUSIC|BGM|SCORE)\b/i.test(label)) return { kind: "music", cue: label, text: body };
    if (/^(?:SFX|FX|SOUND|FOLEY|AMBIENCE|FOOTSTEPS|THUNDER|WIND|RAIN|DOOR|ENGINE|EXPLOSION|GUNSHOT|BIRDS|CROWD)\b/i.test(label)) {
      return { kind: "sfx", cue: label, text: body };
    }
    return { kind: "narration", text: trimmed };
  }

  // Screenplay-style speaker cues are generally short, uppercase labels followed by a colon.
  const speaker = trimmed.match(/^([A-Z][A-Z0-9 _.'-]{1,28})\s*:\s*([\s\S]+)$/);
  if (speaker && !/^(?:NOTE|WARNING|IMPORTANT|TITLE|LOCATION|TIME|DATE)$/i.test(speaker[1].trim())) {
    return { kind: "dialogue", speaker: speaker[1].trim(), text: speaker[2].trim() };
  }

  return { kind: "narration", text: raw };
}

export function parseScript(source: string): ParsedScene[] {
  if (!source.trim()) return [];
  const lines = source.split(/\r?\n/);
  const scenes: ParsedScene[] = [];
  let chapter = "Unassigned chapter";
  let current: ParsedScene | null = null;
  let paragraph: string[] = [];
  let paragraphStartLine = 0;
  let sceneIndex = 0;
  let blockIndex = 0;
  let lineNumber = 0;
  let chapterNeedsScene = false;

  const start = (title: string) => {
    current = { id: `scene-${++sceneIndex}`, title, chapter, blocks: [], sourceText: "" };
    scenes.push(current);
    chapterNeedsScene = false;
  };

  const flush = () => {
    if (!paragraph.length) return;
    const raw = paragraph.join("\n");
    const sourceLine = paragraphStartLine;
    paragraph = [];
    paragraphStartLine = 0;
    if (!raw.trim()) return;

    const classified = classifyParagraph(raw);
    if (!current) start(chapterNeedsScene ? chapter : "Opening");
    current!.blocks.push({
      id: `block-${++blockIndex}`,
      ...classified,
      sourceLine,
    });
    current!.sourceText += (current!.sourceText ? "\n\n" : "") + raw;
  };

  for (const line of lines) {
    lineNumber += 1;
    const value = line.trim();
    if (chapterHeading.test(value)) {
      flush();
      chapter = value;
      const previousScene = scenes[scenes.length - 1];
      if (previousScene && !previousScene.blocks.length) previousScene.chapter = chapter;
      current = null;
      chapterNeedsScene = true;
      continue;
    }
    if (sceneHeading.test(value) || /^#{1,3}\s+\S/.test(value)) {
      flush();
      start(value.replace(/^#+\s*/, ""));
      continue;
    }
    if (!value) {
      flush();
      continue;
    }
    if (!paragraph.length) paragraphStartLine = lineNumber;
    paragraph.push(line);
  }

  flush();
  return scenes;
}
