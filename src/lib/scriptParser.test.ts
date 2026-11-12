import { describe, expect, it } from "vitest";
import { parseScript } from "./scriptParser";

describe("parseScript", () => {
  it("preserves paragraph source and order", () => {
    const scenes = parseScript("First.\n\nSecond.");
    expect(scenes).toHaveLength(1);
    expect(scenes[0].blocks.map(block => block.text)).toEqual(["First.", "Second."]);
    expect(scenes[0].sourceText).toBe("First.\n\nSecond.");
  });

  it("parses chapters, scenes and bracketed markers", () => {
    const scenes = parseScript("CHAPTER 1: Arrival\n\nSCENE 1 - Street\n\n[NARRATOR] Empty.\n\n[CHARACTER: MAYA] Hello\n\n[SFX: THUNDER]\n\n[MUSIC: TENSION]");
    expect(scenes).toHaveLength(1);
    expect(scenes[0].chapter).toBe("CHAPTER 1: Arrival");
    expect(scenes[0].blocks.map(block => block.kind)).toEqual(["narration", "dialogue", "sfx", "music"]);
    expect(scenes[0].blocks[1].speaker).toBe("MAYA");
  });

  it("recognises natural-language music and sound-effect prefixes", () => {
    const scenes = parseScript("Narration: The ship approaches.\n\nBACKGROUND MUSIC: Low orchestral tension builds.\n\nSOUND EFFECT: Metal doors open.\n\nBGM - Music fades out.");
    expect(scenes[0].blocks.map(block => block.kind)).toEqual(["narration", "music", "sfx", "music"]);
    expect(scenes[0].blocks[1].text).toBe("Low orchestral tension builds.");
    expect(scenes[0].blocks[2].text).toBe("Metal doors open.");
  });

  it("recognises screenplay speaker labels and bracketed stage directions", () => {
    const scenes = parseScript("MAYA (whispering): We have to leave.\n\n[Footsteps echo in the corridor]\n\n[Music fades in]");
    expect(scenes[0].blocks.map(block => block.kind)).toEqual(["dialogue", "sfx", "music"]);
    expect(scenes[0].blocks[0].speaker).toBe("MAYA");
    expect(scenes[0].blocks[1].cue).toBe("Footsteps echo in the corridor");
  });

  it("recognises markdown-formatted music labels and sound FX", () => {
    const scenes = parseScript("**MUSIC:** A low drone fades in.\n\nSOUND FX: Distant engine rumble.");
    expect(scenes[0].blocks.map(block => block.kind)).toEqual(["music", "sfx"]);
  });

  it("does not classify ordinary prose merely because it mentions music or sound", () => {
    const scenes = parseScript("The music in the room reminded her of home.\n\nHe heard a strange sound outside.");
    expect(scenes[0].blocks.map(block => block.kind)).toEqual(["narration", "narration"]);
  });


  it("splits consecutive marker lines without requiring blank lines", () => {
    const scenes = parseScript([
      "CHAPTER 1: Morning Routine",
      "SCENE 1 - Kitchen",
      "[NARRATOR] A quiet morning unfolds in a cozy kitchen.",
      "[CHARACTER: ANNIE] Good morning everyone!",
      "[BACKGROUND MUSIC: gentle piano]",
      "[SFX: footsteps]",
      "[Music fades in]",
      "MAYA (whispering): We should leave.",
    ].join("\\n"));
    expect(scenes).toHaveLength(1);
    expect(scenes[0].blocks.map(block => block.kind)).toEqual([
      "narration", "dialogue", "music", "sfx", "music", "dialogue",
    ]);
    expect(scenes[0].blocks.map(block => block.text)).toEqual([
      "A quiet morning unfolds in a cozy kitchen.",
      "Good morning everyone!",
      "gentle piano",
      "footsteps",
      "Music fades in",
      "We should leave.",
    ]);
    expect(scenes[0].blocks[1].speaker).toBe("ANNIE");
    expect(scenes[0].blocks[2].cue).toBe("BACKGROUND MUSIC");
    expect(scenes[0].blocks[3].cue).toBe("SFX");
    expect(scenes[0].blocks[5].speaker).toBe("MAYA");
  });

  it("keeps continuation lines attached to the preceding marked block", () => {
    const scenes = parseScript([
      "[NARRATOR] The ship approaches.",
      "Its engines are silent.",
      "[SFX: low engine hum]",
    ].join("\\n"));
    expect(scenes[0].blocks.map(block => block.kind)).toEqual(["narration", "sfx"]);
    expect(scenes[0].blocks[0].text).toBe("The ship approaches.\\nIts engines are silent.");
    expect(scenes[0].blocks[1].text).toBe("low engine hum");
  });

  it("keeps an opening before an explicit scene", () => {
    expect(parseScript("Opening.\n\nSCENE 1\n\nNext.")).toHaveLength(2);
  });

  it("tracks exact source lines when paragraph text repeats", () => {
    const scenes = parseScript("Repeated\n\nOther\n\nRepeated");
    expect(scenes[0].blocks.map(block => block.sourceLine)).toEqual([1, 3, 5]);
  });

  it("starts a new scene when a chapter changes without an explicit scene heading", () => {
    const scenes = parseScript("CHAPTER 1: First\n\nSCENE 1: Opening\n\nFirst chapter text.\n\nCHAPTER 2: Next\n\nSecond chapter text.");
    expect(scenes).toHaveLength(2);
    expect(scenes[0].chapter).toBe("CHAPTER 1: First");
    expect(scenes[1].chapter).toBe("CHAPTER 2: Next");
    expect(scenes[1].title).toBe("CHAPTER 2: Next");
    expect(scenes[1].blocks.map(block => block.text)).toEqual(["Second chapter text."]);
  });

  it("returns empty for whitespace", () => {
    expect(parseScript(" \n ")).toEqual([]);
  });
});
