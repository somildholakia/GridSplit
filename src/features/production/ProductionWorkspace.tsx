import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Clapperboard, Download, ImagePlus, Maximize2, Pause, Play, RefreshCw, Scissors, SlidersHorizontal, Sparkles, Square, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import { PROJECT_STORAGE_KEY, type StudioProject } from "../../lib/projectStore";
import { readGeneratedAudio } from "../../audio/audioStore";
import ProductionTools from "./ProductionTools";
import ImageAnimationStudio from "./ImageAnimationStudio";
import { measureWavBlob } from "../../lib/mediaTimeline";
import { analyseSequence, buildEvenTimeline, extractSequenceNumber, imageClipAtTime, normalizeMappings, orderMappingsByAssetOrder, sortSequence, timelineDurationSeconds, distributeImagesAcrossScenes, resizeImageClipKeepingTimelineDuration, setAllImageClipDurationsAcrossTimeline, splitImageClipAtTime, type SceneImageMapping, type SequenceAsset, type TimelineClip } from "./productionModel";
import "./production-workspace.css";

type ProductionProject = StudioProject & { imageAssets?: SequenceAsset[]; imageMappings?: SceneImageMapping[]; timelineClips?: TimelineClip[] };
type Props = { project: StudioProject; onUpdate: (patch: Partial<StudioProject>) => void; onRestoreProject?: (project: StudioProject) => void };
const DB = "gridsplit-studio-images", STORE = "image-blobs", VERSION = 1;
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
function seconds(value:number){return Math.floor(value/60)+":"+((value%60).toFixed(2)).padStart(5,"0");}
function rulerInterval(zoom:number){const target=160/Math.max(0.1,zoom);return [1,2,5,10,15,30,60,120,300,600,900,1800,3600].find(value=>value>=target)??3600;}

export default function ProductionWorkspace({project,onUpdate,onRestoreProject}:Props){
  const data=project as ProductionProject;
  const assets=data.imageAssets??[], mappings=data.imageMappings??[], clips=data.timelineClips??[];
  const [thumbs,setThumbs]=useState<Record<string,string>>({});
  const [audioUrls,setAudioUrls]=useState<Record<string,string>>({});
  const [message,setMessage]=useState(""); const [busy,setBusy]=useState(false); const [audioDownloadBusy,setAudioDownloadBusy]=useState(false);
  const [playheadSeconds,setPlayheadSeconds]=useState(0); const [isPlaying,setIsPlaying]=useState(false);
  const [timelineZoom,setTimelineZoom]=useState(24);
  const [bulkImageDuration,setBulkImageDuration]=useState("5.00");
  const [selectedImageClipId,setSelectedImageClipId]=useState<string|null>(null);
  const timelineScrollRef=useRef<HTMLDivElement>(null);
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
  const mappedImageIds=useMemo(()=>{
    const mapped=new Set(mappings.flatMap(mapping=>mapping.imageIds));
    return assets.filter(asset=>mapped.has(asset.id)).sort((left,right)=>left.order-right.order).map(asset=>asset.id);
  },[assets,mappings]);
  const timelineDuration=timelineDurationSeconds(clips);
  const timelineWidth=Math.max(600,Math.ceil(timelineDuration*timelineZoom));
  const currentImageClip=imageClipAtTime(clips,playheadSeconds);
  const currentImage=currentImageClip?assets.find(asset=>asset.id===currentImageClip.assetId):undefined;
  const rulerStep=rulerInterval(timelineZoom);
  const rulerTicks=Array.from({length:Math.floor(timelineDuration/rulerStep)+1},(_,index)=>index*rulerStep);
  if(timelineDuration>0&&rulerTicks[rulerTicks.length-1]!==timelineDuration)rulerTicks.push(timelineDuration);
  const selectedImageClip=clips.find(clip=>clip.id===selectedImageClipId&&clip.track==="images");
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
  const autoMapImages=()=>{
    if(!assets.length||!project.scenes.length)return;
    const hasMappings=mappings.some(mapping=>mapping.imageIds.length>0);
    if(hasMappings&&!window.confirm("Replace the current scene image assignments with an even, sequence-ordered distribution?"))return;
    const next=distributeImagesAcrossScenes(assets,project.scenes.map(scene=>scene.id));
    updateMappings(next);
    setMessage("Automatically assigned "+assets.length+" ordered images across "+project.scenes.length+" scenes. Review the assignments, then generate narration; the timeline will synchronize from measured WAV durations.");
  };
  const toggleMapping=(sceneId:string,imageId:string)=>{
    const selected=new Set(mappedFor(sceneId));
    if(selected.has(imageId))selected.delete(imageId);else selected.add(imageId);
    const next=assets.filter(asset=>selected.has(asset.id)).map(asset=>asset.id);
    updateMappings([...mappings.filter(mapping=>mapping.sceneId!==sceneId),{sceneId,imageIds:next}]);
  };
  const createSchedule=async()=>{
    setBusy(true);setMessage("Measuring all saved WAV audio and evenly distributing images over the complete audio…");
    try{
      const audioInputs:{sceneId:string;durationSeconds:number}[]=[];
      const warnings:string[]=[];
      for(const scene of project.scenes){
        const ready=(project.audioSegments??[]).filter(segment=>segment.sceneId===scene.id&&segment.status==="ready");
        let duration=0;
        for(const segment of ready){
          const blob=await readGeneratedAudio(project.id,segment.id);
          if(!blob){warnings.push(scene.title+": missing audio file for one segment.");continue;}
          try{duration+=(await measureWavBlob(blob)).durationSeconds;}
          catch{warnings.push(scene.title+": unreadable WAV segment.");}
        }
        if(!ready.length)warnings.push(scene.title+": no generated audio was available.");
        if(duration>0)audioInputs.push({sceneId:scene.id,durationSeconds:duration});
      }

      if(!mappedImageIds.length)warnings.push("No images are mapped. Map the images you want to include before building the timeline.");
      const next=buildEvenTimeline(audioInputs,mappedImageIds);
      patchProject(onUpdate,{timelineClips:next});
      setPlayheadSeconds(0);setIsPlaying(false);playbackOriginRef.current=null;
      scheduledSourcesRef.current.forEach(source=>{try{source.stop();}catch{/* already stopped */}});
      scheduledSourcesRef.current=[];
      const totalAudio=audioInputs.reduce((sum,input)=>sum+input.durationSeconds,0);
      const average=mappedImageIds.length>0&&totalAudio>0?(totalAudio/mappedImageIds.length).toFixed(2):"0.00";
      setMessage("Evenly distributed "+mappedImageIds.length+" mapped image(s) across "+totalAudio.toFixed(2)+" seconds of measured audio ("+average+" seconds per image). The image sequence now covers the complete audio without gaps. "+(warnings.length?warnings.join(" "):"All measured audio and mapped images are included."));
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
  useEffect(()=>{
    const revision=++autoSyncRevisionRef.current;
    let cancelled=false;
    const hasAudio=(project.audioSegments??[]).some(segment=>segment.status==="ready");
    if(!mappedImageIds.length||!hasAudio)return;
    const timeout=window.setTimeout(()=>{
      void (async()=>{
        try{
          const inputs:{sceneId:string;durationSeconds:number}[]=[];
          for(const scene of project.scenes){
            const ready=(project.audioSegments??[]).filter(segment=>segment.sceneId===scene.id&&segment.status==="ready");
            let duration=0;
            for(const segment of ready){
              const blob=await readGeneratedAudio(project.id,segment.id);
              if(!blob)continue;
              try{duration+=(await measureWavBlob(blob)).durationSeconds;}catch{/* skip unreadable audio */}
            }
            if(duration>0)inputs.push({sceneId:scene.id,durationSeconds:duration});
          }
          if(cancelled||revision!==autoSyncRevisionRef.current)return;
          const next=buildEvenTimeline(inputs,mappedImageIds);
          patchProject(onUpdateRef.current,{timelineClips:next});
          setPlayheadSeconds(current=>Math.min(current,timelineDurationSeconds(next)));
          const totalAudio=inputs.reduce((sum,input)=>sum+input.durationSeconds,0);
          const average=mappedImageIds.length>0&&totalAudio>0?(totalAudio/mappedImageIds.length).toFixed(2):"0.00";
          setMessage("Auto-synced "+mappedImageIds.length+" images evenly over "+totalAudio.toFixed(2)+" seconds of measured audio ("+average+" seconds per image), covering the full soundtrack.");
        }catch(error){
          if(!cancelled)setMessage(error instanceof Error?error.message:"Automatic media synchronization failed.");
        }
      })();
    },300);
    return()=>{cancelled=true;window.clearTimeout(timeout);};
  },[autoSyncKey,project.id]);
  const editClip=(id:string,value:number)=>{
    if(!Number.isFinite(value)||value<=0)return;
    const clip=clips.find(item=>item.id===id);
    if(!clip)return;
    if(clip.track==="images"){
      const updated=resizeImageClipKeepingTimelineDuration(clips,id,value);
      if(updated===clips){
        setMessage("The image sequence needs enough total audio time to keep every image visible for at least 0.01 seconds.");
        return;
      }
      patchProject(onUpdate,{timelineClips:updated});
      setMessage("Updated image duration to two-decimal precision. Other images were ripple-adjusted across the full timeline so the sequence still covers all measured audio.");
      return;
    }
    patchProject(onUpdate,{timelineClips:clips.map(item=>item.id===id?{...item,durationSeconds:value}:item)});
  };
  const editClipStart=(id:string,value:number)=>{if(!Number.isFinite(value)||value<0)return;patchProject(onUpdate,{timelineClips:clips.map(c=>c.id===id?{...c,startSeconds:value}:c)});};
  const applyBulkImageDuration=()=>{
    const value=Number(bulkImageDuration);
    if(!Number.isFinite(value)||value<0.01){setMessage("Enter an image hold duration of at least 0.01 seconds.");return;}
    const next=setAllImageClipDurationsAcrossTimeline(clips,value);
    if(!next){setMessage("That duration is too long for the complete audio. Reduce it so the final image can still fill at least 0.01 seconds.");return;}
    patchProject(onUpdate,{timelineClips:next});
    setMessage("Applied "+value.toFixed(2)+"s to every image across the full soundtrack. The final image fills the remaining audio tail, so there are no gaps.");
  };
  const fitTimeline=()=>{
    const available=Math.max(260,(timelineScrollRef.current?.clientWidth??960)-150);
    setTimelineZoom(Math.min(160,Math.max(0.1,available/Math.max(1,timelineDuration))));
  };
  const adjustTimelineZoom=(factor:number)=>setTimelineZoom(current=>Math.min(160,Math.max(0.1,current*factor)));
  const splitSelectedImage=()=>{
    if(!selectedImageClip){setMessage("Select an image clip before splitting it.");return;}
    const next=splitImageClipAtTime(clips,selectedImageClip.id,playheadSeconds);
    if(next===clips){setMessage("Move the playhead inside the selected image clip (not at either edge) to split it.");return;}
    patchProject(onUpdate,{timelineClips:next});
    setMessage("Image clip split at "+seconds(playheadSeconds)+". Both halves keep the same source image.");
  };
  const nudgeClip=(id:string,delta:number)=>patchProject(onUpdate,{timelineClips:clips.map(clip=>clip.id===id?{...clip,startSeconds:Math.max(0,clip.startSeconds+delta)}:clip)});
  const stopScheduledAudio=()=>{scheduledSourcesRef.current.forEach(source=>{try{source.stop();}catch{/* source already ended */}});scheduledSourcesRef.current=[];};
  const pauseTimeline=()=>{
    if(playbackOriginRef.current!==null)setPlayheadSeconds(Math.min(timelineDuration,Math.max(0,performance.now()/1000-playbackOriginRef.current)));
    playbackOriginRef.current=null;stopScheduledAudio();setIsPlaying(false);
  };
  const downloadCompleteAudio=async()=>{
    const sceneOrder=new Map(project.scenes.map((scene,index)=>[scene.id,index]));
    const ready=[...(project.audioSegments??[])].filter(segment=>segment.status==="ready").sort((left,right)=>{
      const difference=(sceneOrder.get(left.sceneId)??Number.MAX_SAFE_INTEGER)-(sceneOrder.get(right.sceneId)??Number.MAX_SAFE_INTEGER);
      if(difference!==0)return difference;
      const scene=project.scenes.find(item=>item.id===left.sceneId);
      return (scene?.blocks.findIndex(block=>block.id===left.blockId)??0)-(scene?.blocks.findIndex(block=>block.id===right.blockId)??0);
    });
    if(!ready.length){setMessage("There is no generated audio to download yet.");return;}
    setAudioDownloadBusy(true);setMessage("Combining all generated WAV segments into one complete audio file…");
    const context=new AudioContext();
    try{
      const buffers:AudioBuffer[]=[];
      for(const segment of ready){
        const blob=await readGeneratedAudio(project.id,segment.id);
        if(!blob)throw new Error("A generated audio segment is missing ("+segment.id+"). Regenerate that segment before downloading the complete audio.");
        buffers.push(await context.decodeAudioData(await blob.arrayBuffer()));
      }
      const sampleRate=context.sampleRate,channels=Math.min(2,Math.max(...buffers.map(buffer=>buffer.numberOfChannels)));
      const totalFrames=buffers.reduce((sum,buffer)=>sum+Math.ceil(buffer.duration*sampleRate),0),dataBytes=totalFrames*channels*2;
      if(dataBytes+44>0xffffffff)throw new Error("The combined WAV would exceed the 4 GB WAV file limit.");
      const output=new ArrayBuffer(44+dataBytes),view=new DataView(output);
      const writeText=(offset:number,value:string)=>{for(let index=0;index<value.length;index++)view.setUint8(offset+index,value.charCodeAt(index));};
      writeText(0,"RIFF");view.setUint32(4,36+dataBytes,true);writeText(8,"WAVE");writeText(12,"fmt ");
      view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,channels,true);
      view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*channels*2,true);
      view.setUint16(32,channels*2,true);view.setUint16(34,16,true);writeText(36,"data");view.setUint32(40,dataBytes,true);
      let frameOffset=0;
      for(const buffer of buffers){
        const frames=Math.ceil(buffer.duration*sampleRate);
        const channelData=Array.from({length:channels},(_,channel)=>buffer.getChannelData(Math.min(channel,buffer.numberOfChannels-1)));
        for(let frame=0;frame<frames;frame++)for(let channel=0;channel<channels;channel++){
          const sample=channelData[channel][Math.min(frame,channelData[channel].length-1)]??0,value=Math.max(-1,Math.min(1,sample));
          view.setInt16(44+((frameOffset+frame)*channels+channel)*2,value<0?value*0x8000:value*0x7fff,true);
        }
        frameOffset+=frames;
      }
      const url=URL.createObjectURL(new Blob([output],{type:"audio/wav"})),anchor=document.createElement("a");
      anchor.href=url;anchor.download=(project.name||"gridsplit-project").replace(/[^a-z0-9-_]+/gi,"-")+"-complete-audio.wav";
      document.body.appendChild(anchor);anchor.click();anchor.remove();window.setTimeout(()=>URL.revokeObjectURL(url),60_000);
      setMessage("Downloaded the complete soundtrack as one WAV file ("+ready.length+" audio segments).");
    }catch(error){setMessage(error instanceof Error?error.message:"Could not combine the generated audio.");}
    finally{await context.close().catch(()=>undefined);setAudioDownloadBusy(false);}
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
    {activeTab==="mapping"&&<div className="production-section"><div className="production-actions"><button className="production-button primary" disabled={!assets.length||!project.scenes.length} onClick={autoMapImages}><Sparkles size={14}/> Auto-assign sequence to scenes</button><span>{mappings.reduce((count,mapping)=>count+mapping.imageIds.length,0)} scene assignments</span></div><p className="production-help">Auto-assign divides your ordered image sequence into balanced, consecutive scene batches. You can still fine-tune every scene below. The same image can also be selected in multiple scenes manually.</p>
      {!assets.length||!project.scenes.length?<div className="production-empty">Add images and create scenes before mapping.</div>:project.scenes.map(scene=><article className="production-scene-map" key={scene.id}><header><b>{scene.title}</b><span>{mappedFor(scene.id).length} image(s)</span></header><div className="production-map-grid">{assets.map(asset=><label key={asset.id} className={mappedFor(scene.id).includes(asset.id)?"selected":""}>{thumbs[asset.id]?<img src={thumbs[asset.id]} alt=""/>:<span className="production-thumb-placeholder"/>}<input type="checkbox" checked={mappedFor(scene.id).includes(asset.id)} onChange={()=>toggleMapping(scene.id,asset.id)}/><span>{asset.name}</span></label>)}</div></article>)}
    </div>}
    {activeTab==="timeline"&&<div className="production-section">
      <div className="production-actions"><button className="production-button primary" disabled={busy||!assets.length||!project.scenes.length} onClick={()=>void createSchedule()}><RefreshCw size={14}/>{busy?"Measuring…":"Re-sync images to full audio"}</button><span>{clips.filter(clip=>clip.track==="images").length} images · {clips.filter(clip=>clip.track==="images").length?(timelineDuration/clips.filter(clip=>clip.track==="images").length).toFixed(2)+"s average":"—"} · {seconds(timelineDuration)} total</span></div>
      {!clips.length?<div className="production-empty">Map images to scenes and generate WAV audio, then build the initial schedule.</div>:<>
        <div className="production-playback-controls">
          <button className="production-button" type="button" disabled={audioDownloadBusy||!(project.audioSegments??[]).some(segment=>segment.status==="ready")} onClick={()=>void downloadCompleteAudio()}><Download size={14}/>{audioDownloadBusy?"Preparing audio…":"Download complete audio"}</button>
          <button className="production-button primary" onClick={()=>void playTimeline()}>{isPlaying?<Pause size={14}/>:<Play size={14}/>} {isPlaying?"Pause":"Play timeline"}</button>
          <button className="production-button" onClick={()=>{if(isPlaying)pauseTimeline();setPlayheadSeconds(0);}}><Square size={13}/> Stop</button>
          <button className="production-button" disabled={!selectedImageClip} onClick={splitSelectedImage} title="Split selected image at the playhead"><Scissors size={14}/> Split at playhead</button>
          <label className="production-seek"><span>{seconds(playheadSeconds)}</span><input aria-label="Timeline playhead" type="range" min="0" max={Math.max(0.1,timelineDuration)} step="0.01" value={Math.min(playheadSeconds,timelineDuration)} onChange={event=>seekTimeline(Number(event.target.value))}/><span>{seconds(timelineDuration)}</span></label>
        </div>
        <div className="production-timeline-tools">
          <div className="production-bulk-duration">
            <b>IMAGE HOLD TIME</b>
            <label><input aria-label="Bulk image duration in seconds" type="number" min="0.01" step="0.01" value={bulkImageDuration} onChange={event=>setBulkImageDuration(event.target.value)}/> seconds</label>
            <button className="production-button" onClick={applyBulkImageDuration}>Apply to all images</button>
            <small>Images run in sequence across the complete audio. The final image fills the remaining audio tail.</small>
          </div>
          <div className="production-zoom-tools">
            <b>TIMELINE ZOOM</b>
            <button className="production-button icon-only" title="Zoom out" aria-label="Zoom out timeline" onClick={()=>adjustTimelineZoom(0.7)}><ZoomOut size={14}/></button>
            <input aria-label="Timeline zoom level" type="range" min="0.1" max="160" step="0.1" value={timelineZoom} onChange={event=>setTimelineZoom(Number(event.target.value))}/>
            <button className="production-button icon-only" title="Zoom in" aria-label="Zoom in timeline" onClick={()=>adjustTimelineZoom(1.4)}><ZoomIn size={14}/></button>
            <span>{timelineZoom<1?timelineZoom.toFixed(2):timelineZoom.toFixed(1)} px/s</span>
            <button className="production-button" onClick={fitTimeline}><Maximize2 size={13}/> Fit</button>
          </div>
        </div>
        <div className="production-current-frame">{currentImage&&thumbs[currentImage.id]?<img src={thumbs[currentImage.id]} alt={"Current frame: "+currentImage.name}/>:<div className="production-current-placeholder">No image at this playhead position</div>}<div><b>{currentImage?.name??"Preview monitor"}</b><small>{currentImageClip?project.scenes.find(scene=>scene.id===currentImageClip.sceneId)?.title??"Scene":"Move the playhead to preview a frame"}</small></div></div>
        <div ref={timelineScrollRef} className="production-timeline-scroll"><div className="production-timeline-board" style={{width:timelineWidth+132}}>
          <div className="production-visual-ruler"><b>TIME</b><div className="production-visual-lane" style={{width:timelineWidth}}>{rulerTicks.map((tick,index)=><span key={index} style={{left:tick*timelineZoom}}>{seconds(tick)}</span>)}</div></div>
          {(["images","audio"] as const).map(track=><div className="production-visual-track" key={track}><b>{track==="images"?"IMAGE TRACK":"AUDIO TRACK"}</b><div className="production-visual-lane" style={{width:timelineWidth}}>{clips.filter(clip=>clip.track===track).map(clip=><button key={clip.id} className={"production-visual-clip "+track+(track==="images"&&selectedImageClipId===clip.id?" selected":"")} style={{left:clip.startSeconds*timelineZoom,width:Math.max(6,clip.durationSeconds*timelineZoom)}} title={track==="images"?(assets.find(asset=>asset.id===clip.assetId)?.name??"Image clip"):"Scene audio · "+(project.scenes.find(scene=>scene.id===clip.sceneId)?.title??"Scene")} onClick={()=>{if(track==="images")setSelectedImageClipId(clip.id);seekTimeline(clip.startSeconds);}}>{track==="images"&&clip.assetId&&thumbs[clip.assetId]?<img src={thumbs[clip.assetId]} alt=""/>:null}<span>{track==="images"?(assets.find(asset=>asset.id===clip.assetId)?.name??"Missing image"):(project.scenes.find(scene=>scene.id===clip.sceneId)?.title??"Scene audio")}</span></button>)}</div></div>)}
          <div className="production-visual-playhead" style={{left:132+playheadSeconds*timelineZoom}}/>
        </div></div>
        <div className="production-clip-editors"><b>Clip properties</b>{(["images","audio"] as const).map(track=><section className="production-track" key={track}><h3>{track==="images"?"IMAGE CLIPS":"AUDIO CLIPS"}</h3>{clips.filter(clip=>clip.track===track).sort((a,b)=>a.order-b.order).map(clip=><div className="production-clip" key={clip.id}><b>{track==="images"?"IMG":"WAV"}</b><label>Start <input key={clip.id+"-start-"+clip.startSeconds.toFixed(2)} aria-label="Clip start seconds" type="number" min="0" step="0.01" defaultValue={clip.startSeconds.toFixed(2)} onBlur={event=>editClipStart(clip.id,Number(event.currentTarget.value))} onKeyDown={event=>{if(event.key==="Enter")event.currentTarget.blur();}}/> s</label><label>Duration <input key={clip.id+"-duration-"+clip.durationSeconds.toFixed(2)} aria-label="Clip duration seconds" type="number" min="0.01" step="0.01" defaultValue={clip.durationSeconds.toFixed(2)} onBlur={event=>editClip(clip.id,Number(event.currentTarget.value))} onKeyDown={event=>{if(event.key==="Enter")event.currentTarget.blur();}}/> s</label><span>{project.scenes.find(scene=>scene.id===clip.sceneId)?.title??"Unknown scene"}{clip.assetId?" · "+(assets.find(asset=>asset.id===clip.assetId)?.name??"Missing image"):""}</span><div><button title="Nudge clip earlier by half a second" onClick={()=>nudgeClip(clip.id,-0.5)}><ArrowUp size={13}/></button><button title="Nudge clip later by half a second" onClick={()=>nudgeClip(clip.id,0.5)}><ArrowDown size={13}/></button></div></div>)}</section>)}</div>
        <div className="production-audio-preview"><b>Individual local audio segments</b>{(project.audioSegments??[]).filter(segment=>segment.status==="ready"&&audioUrls[segment.id]).map(segment=><label key={segment.id}>{project.scenes.find(scene=>scene.id===segment.sceneId)?.title??"Scene"}<audio controls preload="none" src={audioUrls[segment.id]}/></label>)}</div>
      </>}
      <p className="production-footnote">Playback follows edited image positions and schedules local WAV segments against scene audio clips. Audio positions use measured WAV durations; edits stay in this browser.</p>
    </div>}
    {activeTab==="animation"&&<ImageAnimationStudio images={assets} imageUrls={thumbs} onImportFiles={(files)=>void addFiles(files)}/>}
    {activeTab==="tools"&&<ProductionTools project={project} onUpdate={onUpdate} onRestoreProject={onRestoreProject}/>} 
  </section>;
}
