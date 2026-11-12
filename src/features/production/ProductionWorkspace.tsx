import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Clapperboard, ImagePlus, Pause, Play, RefreshCw, SlidersHorizontal, Square, Trash2 } from "lucide-react";
import { PROJECT_STORAGE_KEY, type StudioProject } from "../../lib/projectStore";
import { readGeneratedAudio } from "../../audio/audioStore";
import ProductionTools from "./ProductionTools";
import ImageAnimationStudio from "./ImageAnimationStudio";
import { measureWavBlob } from "../../lib/mediaTimeline";
import { analyseSequence, buildTimeline, extractSequenceNumber, imageClipAtTime, normalizeMappings, orderMappingsByAssetOrder, sortSequence, timelineDurationSeconds, type SceneImageMapping, type SequenceAsset, type TimelineClip } from "./productionModel";
import "./production-workspace.css";

type ProductionProject = StudioProject & { imageAssets?: SequenceAsset[]; imageMappings?: SceneImageMapping[]; timelineClips?: TimelineClip[] };
type Props = { project: StudioProject; onUpdate: (patch: Partial<StudioProject>) => void; onRestoreProject?: (project: StudioProject) => void };
const DB = "gridsplit-studio-images", STORE = "image-blobs", VERSION = 1;
const TIMELINE_PIXELS_PER_SECOND = 64;
function openImageDb(): Promise<IDBDatabase> {
  return new Promise((resolve,reject) => {
    const request=indexedDB.open(DB,VERSION);
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE,{keyPath:"id"});};
    request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error ?? new Error("Could not open local image storage."));
  });
}
async function saveImage(id:string,blob:Blob):Promise<void>{
  const db=await openImageDb(); await new Promise<void>((resolve,reject)=>{const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).put({id,blob});tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);}).finally(()=>db.close());
}
async function readImage(id:string):Promise<Blob|null>{
  const db=await openImageDb();return new Promise<Blob|null>((resolve,reject)=>{const tx=db.transaction(STORE,"readonly"),req=tx.objectStore(STORE).get(id);let blob:Blob|null=null;req.onsuccess=()=>{blob=req.result?.blob instanceof Blob?req.result.blob:null;};tx.oncomplete=()=>resolve(blob);tx.onerror=()=>reject(tx.error);}).finally(()=>db.close());
}
async function deleteImage(id:string):Promise<void>{
  const db=await openImageDb();await new Promise<void>((resolve,reject)=>{const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).delete(id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);}).finally(()=>db.close());
}
function isImageUsedByAnotherProject(imageId:string,currentProjectId:string):boolean{
  try{
    const saved=JSON.parse(localStorage.getItem(PROJECT_STORAGE_KEY)??"[]") as unknown;
    return Array.isArray(saved)&&saved.some((entry)=>entry&&typeof entry==="object"
      &&(entry as {id?:unknown}).id!==currentProjectId
      &&Array.isArray((entry as {imageAssets?:unknown}).imageAssets)
      &&((entry as {imageAssets:Array<{id?:unknown}>}).imageAssets).some(asset=>asset.id===imageId));
  }catch{return true;}
}
async function deleteImageIfUnreferenced(imageId:string,currentProjectId:string):Promise<void>{
  if(!isImageUsedByAnotherProject(imageId,currentProjectId))await deleteImage(imageId);
}

/** Remove image blobs belonging only to a deleted project; duplicated projects may share source IDs. */
export async function cleanupProjectImages(project:StudioProject,remainingProjects:StudioProject[]):Promise<void>{
  const assets=(project as ProductionProject).imageAssets??[];
  const referenced=new Set(remainingProjects.flatMap(item=>(item as ProductionProject).imageAssets??[]).map(asset=>asset.id));
  for(const asset of assets)if(!referenced.has(asset.id))await deleteImage(asset.id);
}

async function fingerprint(file:File):Promise<string>{
  try{const digest=await crypto.subtle.digest("SHA-256",await file.arrayBuffer());return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("");}
  catch{return file.name.toLowerCase()+":"+file.size+":"+file.lastModified;}
}
async function dimensions(file:File):Promise<{width:number;height:number}>{
  try{const bitmap=await createImageBitmap(file);const result={width:bitmap.width,height:bitmap.height};bitmap.close();return result;}catch{return {width:0,height:0};}
}
function patchProject(onUpdate:Props["onUpdate"],patch:Partial<ProductionProject>){onUpdate({...patch} as Partial<StudioProject>);}
function seconds(value:number){return Math.floor(value/60)+":"+((value%60).toFixed(1)).padStart(4,"0");}

export default function ProductionWorkspace({project,onUpdate,onRestoreProject}:Props){
  const data=project as ProductionProject;
  const assets=data.imageAssets??[], mappings=data.imageMappings??[], clips=data.timelineClips??[];
  const [thumbs,setThumbs]=useState<Record<string,string>>({});
  const [audioUrls,setAudioUrls]=useState<Record<string,string>>({});
  const [message,setMessage]=useState(""); const [busy,setBusy]=useState(false);
  const [playheadSeconds,setPlayheadSeconds]=useState(0); const [isPlaying,setIsPlaying]=useState(false);
  const audioContextRef=useRef<AudioContext|null>(null);
  const scheduledSourcesRef=useRef<AudioBufferSourceNode[]>([]);
  const playbackOriginRef=useRef<number|null>(null);
  const animationFrameRef=useRef<number|null>(null);
  const folderRef=useRef<HTMLInputElement>(null);
  const onUpdateRef=useRef(onUpdate);
  onUpdateRef.current=onUpdate;
  useEffect(()=>{folderRef.current?.setAttribute("webkitdirectory","");folderRef.current?.setAttribute("directory","");},[]);
  const [activeTab,setActiveTab]=useState<"sequence"|"mapping"|"timeline"|"animation"|"tools">("sequence");
  const issues=useMemo(()=>analyseSequence(assets),[assets]);
  const timelineDuration=timelineDurationSeconds(clips);
  const timelineWidth=Math.max(600,Math.ceil(timelineDuration*TIMELINE_PIXELS_PER_SECOND));
  const currentImageClip=imageClipAtTime(clips,playheadSeconds);
  const currentImage=currentImageClip?assets.find(asset=>asset.id===currentImageClip.assetId):undefined;
  const rulerTicks=Array.from({length:Math.floor(timelineDuration/5)+1},(_,index)=>index*5);
  if(timelineDuration>0&&rulerTicks[rulerTicks.length-1]!==timelineDuration)rulerTicks.push(timelineDuration);
  useEffect(()=>{
    let alive=true;const urls:Record<string,string>={};let missing=0;
    void Promise.all(assets.map(async asset=>{
      try{
        const blob=await readImage(asset.id);
        if(blob)urls[asset.id]=URL.createObjectURL(blob);else missing+=1;
      }catch{missing+=1;}
    })).then(()=>{
      if(alive){
        setThumbs(urls);
        if(missing)setMessage(missing+" image source file(s) are not available in this browser. Re-import those images; JSON backup contains image metadata, not the original image bytes.");
      }else Object.values(urls).forEach(URL.revokeObjectURL);
    });
    return()=>{alive=false;Object.values(urls).forEach(URL.revokeObjectURL);};
  },[assets.map(a=>a.id).join("|")]);
  useEffect(()=>{
    let alive=true;const urls:Record<string,string>={};
    void Promise.all((project.audioSegments??[]).filter(s=>s.status==="ready").map(async s=>{const blob=await readGeneratedAudio(project.id,s.id);if(blob)urls[s.id]=URL.createObjectURL(blob);}))
      .then(()=>{if(alive)setAudioUrls(urls);else Object.values(urls).forEach(URL.revokeObjectURL);});
    return()=>{alive=false;Object.values(urls).forEach(URL.revokeObjectURL);};
  },[project.id,(project.audioSegments??[]).map(s=>s.id+":"+s.status).join("|")]);
  const updateAssets=(next:SequenceAsset[])=>patchProject(onUpdate,{imageAssets:next});
  const updateMappings=(next:SceneImageMapping[])=>patchProject(onUpdate,{imageMappings:normalizeMappings(next,project.scenes.map(s=>s.id),assets.map(a=>a.id))});
  const addFiles=async(files:FileList|null)=>{
    if(!files?.length)return;setBusy(true);setMessage("Reading images and storing originals locally…");
    const savedIds:string[]=[];
    try{
      const valid=[...files].filter(f=>f.type.startsWith("image/")&&f.size>0&&f.size<=100*1024*1024);
      const accepted=valid.slice(0,Math.max(0,10000-assets.length));
      const rejected=files.length-accepted.length;
      const additions:SequenceAsset[]=[];
      const ordered=sortSequence(accepted.map(f=>({name:f.name,relativePath:(f as File&{webkitRelativePath?:string}).webkitRelativePath||f.name,file:f})));
      for(const item of ordered){
        const file=item.file,id=crypto.randomUUID(),hash=await fingerprint(file);
        const size=await dimensions(file);await saveImage(id,file);savedIds.push(id);
        additions.push({id,name:file.name,relativePath:item.relativePath,mimeType:file.type,bytes:file.size,sequenceNumber:extractSequenceNumber(file.name),order:assets.length+additions.length,width:size.width,height:size.height,fingerprint:hash});
      }
      updateAssets([...assets,...additions].map((a,index)=>({...a,order:index})));
      setMessage("Added "+additions.length+" image(s)."+(rejected?" Rejected "+rejected+" file(s): unsupported, empty, oversized, or beyond the 10,000-image project limit.":""));
    }catch(error){
      await Promise.all(savedIds.map(id=>deleteImage(id).catch(()=>undefined)));
      setMessage(error instanceof Error?error.message:"Could not import these images.");
    }finally{setBusy(false);}
  };
  const removeAsset=async(id:string)=>{
    await deleteImageIfUnreferenced(id,project.id);updateAssets(assets.filter(a=>a.id!==id).map((a,index)=>({...a,order:index})));
    patchProject(onUpdate,{imageMappings:normalizeMappings(mappings.map(m=>({...m,imageIds:m.imageIds.filter(x=>x!==id)})),project.scenes.map(s=>s.id),assets.filter(a=>a.id!==id).map(a=>a.id)),timelineClips:clips.filter(c=>c.assetId!==id)});
  };
  const moveAsset=(index:number,direction:-1|1)=>{
    const next=[...assets],target=index+direction;if(target<0||target>=next.length)return;
    [next[index],next[target]]=[next[target],next[index]];
    const ordered=next.map((asset,itemIndex)=>({...asset,order:itemIndex}));
    updateAssets(ordered);
    patchProject(onUpdate,{imageMappings:orderMappingsByAssetOrder(mappings,ordered)});
  };
  const setFrameNumber=(id:string,value:string)=>{
    const number=value.trim()===""?null:Number(value);
    if(number!==null&&(!Number.isSafeInteger(number)||number<0)){setMessage("Frame number must be a non-negative whole number.");return;}
    updateAssets(assets.map(a=>a.id===id?{...a,sequenceNumber:number}:a));
  };
  const mappedFor=(sceneId:string)=>mappings.find(m=>m.sceneId===sceneId)?.imageIds??[];
  const toggleMapping=(sceneId:string,imageId:string)=>{
    const selected=new Set(mappedFor(sceneId));
    if(selected.has(imageId))selected.delete(imageId);else selected.add(imageId);
    const next=assets.filter(asset=>selected.has(asset.id)).map(asset=>asset.id);
    updateMappings([...mappings.filter(mapping=>mapping.sceneId!==sceneId),{sceneId,imageIds:next}]);
  };
  const createSchedule=async()=>{
    setBusy(true);setMessage("Measuring saved WAV audio and building the image schedule…");
    try{
      const inputs:{sceneId:string;durationSeconds:number;imageIds:string[]}[]=[];
      const warnings:string[]=[];
      for(const scene of project.scenes){
        const ready=(project.audioSegments??[]).filter(s=>s.sceneId===scene.id&&s.status==="ready");
        let duration=0;
        for(const segment of ready){
          const blob=await readGeneratedAudio(project.id,segment.id);
          if(!blob){warnings.push(scene.title+": missing audio file for one segment.");continue;}
          try{duration+=(await measureWavBlob(blob)).durationSeconds;}catch{warnings.push(scene.title+": unreadable WAV segment.");}
        }
        if(!ready.length)warnings.push(scene.title+": no generated audio; no timed image clips were created.");
        const imageIds=mappedFor(scene.id);
        if(!imageIds.length)warnings.push(scene.title+": no images mapped.");
        if(duration>0&&imageIds.length)inputs.push({sceneId:scene.id,durationSeconds:duration,imageIds});
      }
      const next=buildTimeline(inputs);patchProject(onUpdate,{timelineClips:next});
      setPlayheadSeconds(0);setIsPlaying(false);playbackOriginRef.current=null;
      scheduledSourcesRef.current.forEach(source=>{try{source.stop();}catch{/* already stopped */}});
      scheduledSourcesRef.current=[];
      setMessage("Built "+next.filter(c=>c.track==="images").length+" image clips from measured WAV durations. "+(warnings.length?warnings.join(" "):"All scenes with generated audio have mapped images."));
      setActiveTab("timeline");
    }catch(error){setMessage(error instanceof Error?error.message:"Could not build the schedule.");}finally{setBusy(false);}
  };
  // Keep the image and speech tracks aligned automatically whenever source media,
  // image order/mappings, or generated-audio readiness changes. Manual clip edits
  // remain intact until one of those source inputs changes again.
  const autoSyncKey = [
    assets.map(asset=>asset.id+":"+asset.order).join(","),
    mappings.map(mapping=>mapping.sceneId+":"+mapping.imageIds.join(",")).join("|"),
    project.scenes.map(scene=>scene.id).join(","),
    (project.audioSegments??[]).map(segment=>segment.id+":"+segment.status+":"+String(segment.durationSeconds??"")).join(","),
  ].join("::");
  const autoSyncRevisionRef=useRef(0);
  // The serialized source key captures the media/mapping inputs intentionally.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{
    const revision=++autoSyncRevisionRef.current;
    let cancelled=false;
    const hasInputs=project.scenes.some(scene=>
      (mappings.find(mapping=>mapping.sceneId===scene.id)?.imageIds.length??0)>0
      &&(project.audioSegments??[]).some(segment=>segment.sceneId===scene.id&&segment.status==="ready"));
    if(!hasInputs)return;
    const timeout=window.setTimeout(()=>{
      void (async()=>{
        try{
          const inputs:{sceneId:string;durationSeconds:number;imageIds:string[]}[]=[];
          for(const scene of project.scenes){
            const ready=(project.audioSegments??[]).filter(segment=>segment.sceneId===scene.id&&segment.status==="ready");
            let duration=0;
            for(const segment of ready){
              const blob=await readGeneratedAudio(project.id,segment.id);
              if(!blob)continue;
              try{duration+=(await measureWavBlob(blob)).durationSeconds;}catch{/* skip unreadable audio */}
            }
            const imageIds=mappings.find(mapping=>mapping.sceneId===scene.id)?.imageIds??[];
            if(duration>0&&imageIds.length)inputs.push({sceneId:scene.id,durationSeconds:duration,imageIds});
          }
          if(cancelled||revision!==autoSyncRevisionRef.current)return;
          const next=buildTimeline(inputs);
          patchProject(onUpdateRef.current,{timelineClips:next});
          setPlayheadSeconds(current=>Math.min(current,timelineDurationSeconds(next)));
          setMessage("Auto-synced "+next.filter(clip=>clip.track==="images").length+" image clips with measured narration/dialogue audio.");
        }catch(error){
          if(!cancelled)setMessage(error instanceof Error?error.message:"Automatic media synchronization failed.");
        }
      })();
    },300);
    return()=>{cancelled=true;window.clearTimeout(timeout);};
  },[autoSyncKey,project.id]);
  const editClip=(id:string,value:number)=>{
    if(!Number.isFinite(value)||value<=0)return;
    patchProject(onUpdate,{timelineClips:clips.map(c=>c.id===id?{...c,durationSeconds:value}:c)});
  };
  const editClipStart=(id:string,value:number)=>{if(!Number.isFinite(value)||value<0)return;patchProject(onUpdate,{timelineClips:clips.map(c=>c.id===id?{...c,startSeconds:value}:c)});};
  const nudgeClip=(id:string,delta:number)=>patchProject(onUpdate,{timelineClips:clips.map(clip=>clip.id===id?{...clip,startSeconds:Math.max(0,clip.startSeconds+delta)}:clip)});
  const stopScheduledAudio=()=>{scheduledSourcesRef.current.forEach(source=>{try{source.stop();}catch{/* source already ended */}});scheduledSourcesRef.current=[];};
  const pauseTimeline=()=>{
    if(playbackOriginRef.current!==null)setPlayheadSeconds(Math.min(timelineDuration,Math.max(0,performance.now()/1000-playbackOriginRef.current)));
    playbackOriginRef.current=null;stopScheduledAudio();setIsPlaying(false);
  };
  const playTimeline=async()=>{
    if(isPlaying){pauseTimeline();return;}
    if(!clips.length||timelineDuration<=0){setMessage("Build a timeline before starting playback.");return;}
    stopScheduledAudio();
    try{
      const context=audioContextRef.current??new AudioContext();audioContextRef.current=context;
      await context.resume();
      const sceneOrder=new Map(project.scenes.map((scene,index)=>[scene.id,index]));
      const audioClips=new Map(clips.filter(clip=>clip.track==="audio").map(clip=>[clip.sceneId,clip]));
      const offsets=new Map<string,number>();
      const ready=[...(project.audioSegments??[])].filter(segment=>segment.status==="ready").sort((left,right)=>{
        const sceneDifference=(sceneOrder.get(left.sceneId)??Number.MAX_SAFE_INTEGER)-(sceneOrder.get(right.sceneId)??Number.MAX_SAFE_INTEGER);
        if(sceneDifference!==0)return sceneDifference;
        const scene=project.scenes.find(item=>item.id===left.sceneId);
        return (scene?.blocks.findIndex(block=>block.id===left.blockId)??0)-(scene?.blocks.findIndex(block=>block.id===right.blockId)??0);
      });
      const decoded:{buffer:AudioBuffer;startSeconds:number;endSeconds:number}[]=[];
      const missing:string[]=[];
      for(const segment of ready){
        const sceneClip=audioClips.get(segment.sceneId);if(!sceneClip)continue;
        const offset=offsets.get(segment.sceneId)??0;
        const startSeconds=sceneClip.startSeconds+offset;
        const blob=await readGeneratedAudio(project.id,segment.id);
        if(!blob){missing.push(segment.id);offsets.set(segment.sceneId,offset+(segment.durationSeconds??0));continue;}
        const buffer=await context.decodeAudioData(await blob.arrayBuffer());
        const allowedDuration=Math.max(0,sceneClip.startSeconds+sceneClip.durationSeconds-startSeconds);
        const duration=Math.min(buffer.duration,allowedDuration);
        offsets.set(segment.sceneId,offset+buffer.duration);
        if(duration>0)decoded.push({buffer,startSeconds,endSeconds:startSeconds+duration});
      }
      const now=context.currentTime+0.05;
      for(const part of decoded){
        if(part.endSeconds<=playheadSeconds)continue;
        const offset=Math.max(0,playheadSeconds-part.startSeconds);
        const source=context.createBufferSource();source.buffer=part.buffer;source.connect(context.destination);
        source.start(now+Math.max(0,part.startSeconds-playheadSeconds),offset,part.endSeconds-part.startSeconds-offset);
        scheduledSourcesRef.current.push(source);
      }
      playbackOriginRef.current=performance.now()/1000+0.05-playheadSeconds;setIsPlaying(true);
      if(missing.length)setMessage("Playback started. "+missing.length+" saved WAV file(s) were missing and were skipped.");
      else if(!decoded.length)setMessage("Timeline playback is running visually; no ready audio clips were available.");
      else setMessage("Synchronized timeline playback started.");
    }catch(error){setMessage(error instanceof Error?error.message:"Could not start timeline playback.");}
  };
  useEffect(()=>{
    if(!isPlaying)return;
    const tick=()=>{
      const origin=playbackOriginRef.current;if(origin===null)return;
      const next=Math.max(0,performance.now()/1000-origin);
      if(next>=timelineDuration){setPlayheadSeconds(timelineDuration);playbackOriginRef.current=null;stopScheduledAudio();setIsPlaying(false);return;}
      setPlayheadSeconds(next);animationFrameRef.current=requestAnimationFrame(tick);
    };
    animationFrameRef.current=requestAnimationFrame(tick);
    return()=>{if(animationFrameRef.current!==null)cancelAnimationFrame(animationFrameRef.current);};
  },[isPlaying,timelineDuration]);
  useEffect(()=>()=>{ 
    if(animationFrameRef.current!==null)cancelAnimationFrame(animationFrameRef.current);
    scheduledSourcesRef.current.forEach(source=>{try{source.stop();}catch{/* already stopped */}});
    void audioContextRef.current?.close();
  },[]);
  const seekTimeline=(value:number)=>{if(isPlaying)pauseTimeline();setPlayheadSeconds(Math.min(timelineDuration,Math.max(0,value)));};
  const clearAssets=async()=>{for(const asset of assets)await deleteImageIfUnreferenced(asset.id,project.id);updateAssets([]);updateMappings([]);patchProject(onUpdate,{timelineClips:[]});setMessage("Removed all image assets from this project.");};
  return <section className="production-workspace">
    <header className="production-head"><div><span className="production-kicker">M22–M25 · PRODUCTION WORKSPACE</span><h2>Images to timeline.</h2><p>Keep source images local, resolve sequence issues, map them to scenes, and schedule them against measured audio.</p></div><Clapperboard size={26}/></header>
    <nav className="production-tabs" aria-label="Production steps">
      <button className={activeTab==="sequence"?"active":""} onClick={()=>setActiveTab("sequence")}>1. Image sequence <span>{assets.length}</span></button>
      <button className={activeTab==="mapping"?"active":""} onClick={()=>setActiveTab("mapping")}>2. Scene mapping <span>{mappings.filter(m=>m.imageIds.length).length}</span></button>
      <button className={activeTab==="timeline"?"active":""} onClick={()=>setActiveTab("timeline")}>3. Timeline <span>{clips.length}</span></button>
      <button className={activeTab==="animation"?"active":""} onClick={()=>setActiveTab("animation")}>4. Image animation <span>{assets.length}</span></button>
      <button className={activeTab==="tools"?"active":""} onClick={()=>setActiveTab("tools")}><SlidersHorizontal size={13}/> 5. Mix & export</button>
    </nav>
    {message&&<p className="production-message" role="status">{message}</p>}
    {activeTab==="sequence"&&<div className="production-section">
      <div className="production-actions"><label className="production-button"><ImagePlus size={15}/> Add images<input type="file" accept="image/*" multiple onChange={e=>{void addFiles(e.target.files);e.currentTarget.value="";}}/></label><button type="button" className="production-button" onClick={()=>folderRef.current?.click()}><ImagePlus size={15}/> Add folder</button><input ref={folderRef} type="file" accept="image/*" multiple hidden onChange={e=>{void addFiles(e.target.files);e.currentTarget.value="";}}/><button className="production-button danger" disabled={!assets.length} onClick={()=>void clearAssets()}><Trash2 size={14}/> Clear all</button><span>{assets.length} images · thumbnails and originals stored locally</span></div>
      {issues.length>0&&<div className="production-issues"><b><AlertTriangle size={15}/> {issues.length} sequence issue(s) to review</b><ul>{issues.map((issue,i)=><li key={i}>{issue.message}</li>)}</ul></div>}
      {!assets.length?<div className="production-empty">Add your numbered storyboard images to start sequence management.</div>:<div className="production-assets">{assets.map((asset,index)=><article className={"production-asset"+(issues.some(issue=>issue.assetIds.includes(asset.id))?" has-issue":"")} key={asset.id}>
        {thumbs[asset.id]?<img src={thumbs[asset.id]} alt={asset.name}/>:<div className="production-thumb-placeholder">Preview</div>}
        <div className="production-asset-info"><b>{asset.name}</b><small>{asset.width&&asset.height?asset.width+" × "+asset.height+" · ":""}{(asset.bytes/1024).toFixed(0)} KB</small>{issues.filter(issue=>issue.assetIds.includes(asset.id)).map((issue,i)=><small className="production-asset-issue" key={i}>{issue.kind==="gap"?"Sequence gap · review":issue.kind==="duplicate"?"Duplicate · review":"Unnumbered · review"}</small>)}<label>Frame number<input aria-label={"Frame number for "+asset.name} value={asset.sequenceNumber??""} placeholder="Unnumbered" onChange={e=>setFrameNumber(asset.id,e.target.value)}/></label></div>
        <div className="production-asset-controls"><button title="Move earlier" disabled={index===0} onClick={()=>moveAsset(index,-1)}><ArrowUp size={14}/></button><button title="Move later" disabled={index===assets.length-1} onClick={()=>moveAsset(index,1)}><ArrowDown size={14}/></button><button title="Remove image" onClick={()=>void removeAsset(asset.id)}><Trash2 size={14}/></button></div>
      </article>)}</div>}
      <p className="production-footnote">Repeated frame numbers and matching content fingerprints are flagged for review, not silently deleted. Correct frame numbers and visual order independently.</p>
    </div>}
    {activeTab==="mapping"&&<div className="production-section"><p className="production-help">Select any number of images for each scene. The same image may be reused in multiple scenes, and each scene may contain multiple images.</p>
      {!assets.length||!project.scenes.length?<div className="production-empty">Add images and create scenes before mapping.</div>:project.scenes.map(scene=><article className="production-scene-map" key={scene.id}><header><b>{scene.title}</b><span>{mappedFor(scene.id).length} image(s)</span></header><div className="production-map-grid">{assets.map(asset=><label key={asset.id} className={mappedFor(scene.id).includes(asset.id)?"selected":""}>{thumbs[asset.id]?<img src={thumbs[asset.id]} alt=""/>:<span className="production-thumb-placeholder"/>}<input type="checkbox" checked={mappedFor(scene.id).includes(asset.id)} onChange={()=>toggleMapping(scene.id,asset.id)}/><span>{asset.name}</span></label>)}</div></article>)}
    </div>}
    {activeTab==="timeline"&&<div className="production-section">
      <div className="production-actions"><button className="production-button primary" disabled={busy||!assets.length||!project.scenes.length} onClick={()=>void createSchedule()}><RefreshCw size={14}/>{busy?"Measuring…":"Rebuild from measured audio"}</button><span>{clips.length} clips · {seconds(timelineDuration)} total</span></div>
      {!clips.length?<div className="production-empty">Map images to scenes and generate WAV audio, then build the initial schedule.</div>:<>
        <div className="production-playback-controls">
          <button className="production-button primary" onClick={()=>void playTimeline()}>{isPlaying?<Pause size={14}/>:<Play size={14}/>} {isPlaying?"Pause":"Play timeline"}</button>
          <button className="production-button" onClick={()=>{if(isPlaying)pauseTimeline();setPlayheadSeconds(0);}}><Square size={13}/> Stop</button>
          <label className="production-seek"><span>{seconds(playheadSeconds)}</span><input aria-label="Timeline playhead" type="range" min="0" max={Math.max(0.1,timelineDuration)} step="0.01" value={Math.min(playheadSeconds,timelineDuration)} onChange={event=>seekTimeline(Number(event.target.value))}/><span>{seconds(timelineDuration)}</span></label>
        </div>
        <div className="production-current-frame">{currentImage&&thumbs[currentImage.id]?<img src={thumbs[currentImage.id]} alt={"Current frame: "+currentImage.name}/>:<div className="production-current-placeholder">No image at this playhead position</div>}<div><b>{currentImage?.name??"Preview monitor"}</b><small>{currentImageClip?project.scenes.find(scene=>scene.id===currentImageClip.sceneId)?.title??"Scene":"Move the playhead to preview a frame"}</small></div></div>
        <div className="production-timeline-scroll"><div className="production-timeline-board" style={{width:timelineWidth+132}}>
          <div className="production-visual-ruler"><b>TIME</b><div className="production-visual-lane" style={{width:timelineWidth}}>{rulerTicks.map((tick,index)=><span key={index} style={{left:tick*TIMELINE_PIXELS_PER_SECOND}}>{seconds(tick)}</span>)}</div></div>
          {(["images","audio"] as const).map(track=><div className="production-visual-track" key={track}><b>{track==="images"?"IMAGE TRACK":"AUDIO TRACK"}</b><div className="production-visual-lane" style={{width:timelineWidth}}>{clips.filter(clip=>clip.track===track).map(clip=><button key={clip.id} className={"production-visual-clip "+track} style={{left:clip.startSeconds*TIMELINE_PIXELS_PER_SECOND,width:Math.max(30,clip.durationSeconds*TIMELINE_PIXELS_PER_SECOND)}} title={track==="images"?(assets.find(asset=>asset.id===clip.assetId)?.name??"Image clip"):"Scene audio · "+(project.scenes.find(scene=>scene.id===clip.sceneId)?.title??"Scene")} onClick={()=>seekTimeline(clip.startSeconds)}>{track==="images"&&clip.assetId&&thumbs[clip.assetId]?<img src={thumbs[clip.assetId]} alt=""/>:null}<span>{track==="images"?(assets.find(asset=>asset.id===clip.assetId)?.name??"Missing image"):(project.scenes.find(scene=>scene.id===clip.sceneId)?.title??"Scene audio")}</span></button>)}</div></div>)}
          <div className="production-visual-playhead" style={{left:132+playheadSeconds*TIMELINE_PIXELS_PER_SECOND}}/>
        </div></div>
        <div className="production-clip-editors"><b>Clip properties</b>{(["images","audio"] as const).map(track=><section className="production-track" key={track}><h3>{track==="images"?"IMAGE CLIPS":"AUDIO CLIPS"}</h3>{clips.filter(clip=>clip.track===track).sort((a,b)=>a.order-b.order).map(clip=><div className="production-clip" key={clip.id}><b>{track==="images"?"IMG":"WAV"}</b><label>Start <input aria-label="Clip start seconds" type="number" min="0" step="0.1" value={Number(clip.startSeconds.toFixed(2))} onChange={event=>editClipStart(clip.id,Number(event.target.value))}/> s</label><label>Duration <input aria-label="Clip duration seconds" type="number" min="0.1" step="0.1" value={Number(clip.durationSeconds.toFixed(2))} onChange={event=>editClip(clip.id,Number(event.target.value))}/> s</label><span>{project.scenes.find(scene=>scene.id===clip.sceneId)?.title??"Unknown scene"}{clip.assetId?" · "+(assets.find(asset=>asset.id===clip.assetId)?.name??"Missing image"):""}</span><div><button title="Nudge clip earlier by half a second" onClick={()=>nudgeClip(clip.id,-0.5)}><ArrowUp size={13}/></button><button title="Nudge clip later by half a second" onClick={()=>nudgeClip(clip.id,0.5)}><ArrowDown size={13}/></button></div></div>)}</section>)}</div>
        <div className="production-audio-preview"><b>Individual local audio segments</b>{(project.audioSegments??[]).filter(segment=>segment.status==="ready"&&audioUrls[segment.id]).map(segment=><label key={segment.id}>{project.scenes.find(scene=>scene.id===segment.sceneId)?.title??"Scene"}<audio controls preload="none" src={audioUrls[segment.id]}/></label>)}</div>
      </>}
      <p className="production-footnote">Playback follows edited image positions and schedules local WAV segments against scene audio clips. Audio positions use measured WAV durations; edits stay in this browser.</p>
    </div>}
    {activeTab==="animation"&&<ImageAnimationStudio images={assets} imageUrls={thumbs} onImportFiles={(files)=>void addFiles(files)}/>}
    {activeTab==="tools"&&<ProductionTools project={project} onUpdate={onUpdate} onRestoreProject={onRestoreProject}/>} 
  </section>;
}
