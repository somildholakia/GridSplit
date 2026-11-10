export type SequenceAsset = {
  id: string; name: string; relativePath: string; mimeType: string; bytes: number;
  sequenceNumber: number | null; order: number; width: number; height: number; fingerprint: string;
};
export type SequenceIssue = { kind: "gap" | "duplicate" | "unnumbered"; message: string; assetIds: string[] };
export type SceneImageMapping = { sceneId: string; imageIds: string[] };
export type TimelineClip = {
  id: string; track: "images" | "audio"; sceneId: string; assetId?: string; segmentId?: string;
  startSeconds: number; durationSeconds: number; order: number;
};
export type SceneTimingInput = { sceneId: string; durationSeconds: number; imageIds: string[] };

export function extractSequenceNumber(name: string): number | null {
  const stem = name.replace(/\\.[^.]+$/, "");
  const matches = [...stem.matchAll(/(?:^|\\D)(\\d{1,8})(?=\\D|$)/g)];
  if (!matches.length) return null;
  const value = Number(matches[matches.length - 1][1]);
  return Number.isSafeInteger(value) ? value : null;
}
export function sortSequence<T extends { name: string; relativePath: string }>(items: T[]): T[] {
  return [...items].sort((a,b) => a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true, sensitivity: "base" }));
}
export function analyseSequence(items: SequenceAsset[]): SequenceIssue[] {
  const issues: SequenceIssue[] = [];
  const numbered = items.filter(item => item.sequenceNumber !== null).sort((a,b) => a.sequenceNumber! - b.sequenceNumber! || a.order-b.order);
  const seen = new Map<number, SequenceAsset[]>();
  for (const item of numbered) seen.set(item.sequenceNumber!, [...(seen.get(item.sequenceNumber!) ?? []), item]);
  for (const [number, group] of seen) if (group.length > 1) issues.push({kind:"duplicate",message:`Frame ${number} is used by ${group.length} files.`,assetIds:group.map(x=>x.id)});
  for (let i=1;i<numbered.length;i++) {
    const previous=numbered[i-1].sequenceNumber!, current=numbered[i].sequenceNumber!;
    if (current-previous>1) issues.push({kind:"gap",message:`Missing frame(s) ${previous+1}${current-previous>2?`–${current-1}`:""} before ${numbered[i].name}.`,assetIds:[numbered[i-1].id,numbered[i].id]});
  }
  for (const item of items) if (item.sequenceNumber===null) issues.push({kind:"unnumbered",message:`${item.name} has no detectable frame number.`,assetIds:[item.id]});
  return issues;
}
export function normalizeMappings(mappings: SceneImageMapping[], sceneIds: string[], assetIds: string[]): SceneImageMapping[] {
  const validScenes=new Set(sceneIds), validAssets=new Set(assetIds);
  return mappings.filter(m=>validScenes.has(m.sceneId)).map(m=>({sceneId:m.sceneId,imageIds:[...new Set(m.imageIds.filter(id=>validAssets.has(id)))]}));
}
export function buildTimeline(inputs: SceneTimingInput[], makeId:()=>string=()=>crypto.randomUUID()): TimelineClip[] {
  let cursor=0; const clips:TimelineClip[]=[];
  for (const scene of inputs) {
    const ids=scene.imageIds;
    const duration=Math.max(0,scene.durationSeconds);
    ids.forEach((assetId,index)=>{
      const start=cursor+duration*index/Math.max(1,ids.length);
      const end=cursor+duration*(index+1)/Math.max(1,ids.length);
      clips.push({id:makeId(),track:"images",sceneId:scene.sceneId,assetId,startSeconds:start,durationSeconds:end-start,order:clips.length});
    });
    clips.push({id:makeId(),track:"audio",sceneId:scene.sceneId,startSeconds:cursor,durationSeconds:duration,order:clips.length});
    cursor+=duration;
  }
  return clips;
}
export function moveTimelineClip(clips:TimelineClip[],clipId:string,direction:-1|1):TimelineClip[] {
  const index=clips.findIndex(c=>c.id===clipId); if(index<0)return clips;
  const track=clips[index].track, peers=clips.filter(c=>c.track===track).sort((a,b)=>a.order-b.order);
  const at=peers.findIndex(c=>c.id===clipId), target=at+direction;
  if(target<0||target>=peers.length)return clips;
  [peers[at],peers[target]]=[peers[target],peers[at]];
  const orders=new Map(peers.map((c,i)=>[c.id,i]));
  return clips.map(c=>orders.has(c.id)?{...c,order:orders.get(c.id)!}:c);
}
