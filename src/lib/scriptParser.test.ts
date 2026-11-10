import {describe,expect,it} from "vitest";
import {parseScript} from "./scriptParser";
describe("parseScript",()=>{
 it("preserves paragraph source and order",()=>{const s=parseScript("First.\n\nSecond.");expect(s).toHaveLength(1);expect(s[0].blocks.map(b=>b.text)).toEqual(["First.","Second."]);expect(s[0].sourceText).toBe("First.\n\nSecond.");});
 it("parses chapters, scenes and marker kinds",()=>{const s=parseScript("CHAPTER 1: Arrival\n\nSCENE 1 - Street\n\n[NARRATOR] Empty.\n\n[CHARACTER: MAYA] Hello\n\n[SFX: THUNDER]\n\n[MUSIC: TENSION]");expect(s).toHaveLength(1);expect(s[0].chapter).toBe("CHAPTER 1: Arrival");expect(s[0].blocks.map(b=>b.kind)).toEqual(["narration","dialogue","sfx","music"]);expect(s[0].blocks[1].speaker).toBe("MAYA");});
 it("keeps an opening before an explicit scene",()=>expect(parseScript("Opening.\n\nSCENE 1\n\nNext.")).toHaveLength(2));
 it("tracks exact source lines when paragraph text repeats",()=>{const s=parseScript("Repeated\n\nOther\n\nRepeated");expect(s[0].blocks.map(b=>b.sourceLine)).toEqual([1,3,5]);});
 it("starts a new scene when a chapter changes without an explicit scene heading",()=>{const s=parseScript("CHAPTER 1: First\n\nSCENE 1: Opening\n\nFirst chapter text.\n\nCHAPTER 2: Next\n\nSecond chapter text.");expect(s).toHaveLength(2);expect(s[0].chapter).toBe("CHAPTER 1: First");expect(s[1].chapter).toBe("CHAPTER 2: Next");expect(s[1].title).toBe("CHAPTER 2: Next");expect(s[1].blocks.map(b=>b.text)).toEqual(["Second chapter text."]);});
 it("returns empty for whitespace",()=>expect(parseScript(" \n ")).toEqual([]));
});
