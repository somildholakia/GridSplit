export type BlockKind = "narration" | "dialogue" | "sfx" | "music";
export type ParsedBlock = { id:string; kind:BlockKind; text:string; speaker?:string; cue?:string; sourceLine:number };
export type ParsedScene = { id:string; title:string; chapter:string; blocks:ParsedBlock[]; sourceText:string };
const chapterHeading=/^(?:chapter|part)\s+\d+\b.*$/i;
const sceneHeading=/^(?:scene|sequence)\s+\d+\b.*$/i;
const marker=/^\[(NARRATOR|CHARACTER\s*:\s*[^\]]+|SFX\s*:\s*[^\]]+|MUSIC\s*:\s*[^\]]+)\]\s*(.*)$/i;
export function parseScript(source:string):ParsedScene[]{
 if(!source.trim()) return [];
 const lines=source.split(/\r?\n/); const scenes:ParsedScene[]=[]; let chapter="Unassigned chapter";
 let current:ParsedScene|null=null; let paragraph:string[]=[]; let paragraphStartLine=0; let lineNumber=0; let si=0,bi=0; let chapterNeedsScene=false;
 const start=(title:string)=>{current={id:`scene-${++si}`,title,chapter,blocks:[],sourceText:""};scenes.push(current);chapterNeedsScene=false;};
 const flush=()=>{if(!paragraph.length)return;const raw=paragraph.join("\n"),trimmed=raw.trim(),sourceLine=paragraphStartLine;paragraph=[];paragraphStartLine=0;
  if(!trimmed)return;
  const m=marker.exec(trimmed);let kind:BlockKind="narration",speaker:string|undefined,cue:string|undefined,text=raw;
  if(m){const tag=m[1].toUpperCase();text=m[2]||"";if(tag.startsWith("CHARACTER")){kind="dialogue";speaker=tag.split(":").slice(1).join(":").trim();}else if(tag.startsWith("SFX")){kind="sfx";cue=tag.split(":").slice(1).join(":").trim();}else if(tag.startsWith("MUSIC")){kind="music";cue=tag.split(":").slice(1).join(":").trim();}}
  if(!current)start(chapterNeedsScene?chapter:"Opening");
  current!.blocks.push({id:`block-${++bi}`,kind,text,speaker,cue,sourceLine});
  current!.sourceText+=(current!.sourceText?"\n\n":"")+raw;
 };
 for(const line of lines){lineNumber+=1;const v=line.trim();
  if(chapterHeading.test(v)){flush();chapter=v;const previousScene=scenes[scenes.length-1];if(previousScene&&!previousScene.blocks.length)previousScene.chapter=chapter;current=null;chapterNeedsScene=true;continue;}
  if(sceneHeading.test(v)||/^#{1,3}\s+\S/.test(v)){flush();start(v.replace(/^#+\s*/,""));continue;}
  if(!v){flush();continue;}if(!paragraph.length)paragraphStartLine=lineNumber;paragraph.push(line);
 }
 flush();return scenes;
}
