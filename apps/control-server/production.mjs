/** Durable local team workflow. Reviews are named operator attestations, not remote RBAC. */
import {mkdir,readFile,open,rename,stat,rm,chmod} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {portableHash} from './workspace.mjs';
const exec=promisify(execFile),clone=structuredClone;
const bad=(code,status=422)=>Object.assign(new Error(code),{code,status});
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const text=(s,n,optional=false)=>{if(typeof s!=='string'||s.length>n||(!optional&&!s.trim()))throw bad('PRODUCTION_TEXT_INVALID');return s.trim();};
const blank=()=>({revision:0,briefs:[],reviews:[],timeline:{clips:[],audioAssetId:null},events:[],renders:[]});
export function createProductionStore({root,workspace,assets,execImpl=exec}){
 const folder=resolve(root),file=join(folder,'production.json');let projects={},chain=Promise.resolve(),renderBusy=false;
 const renderSources=new Set();
 const serial=fn=>{const p=chain.then(fn);chain=p.catch(()=>{});return p;};
 async function persist(){const path=file+'.'+randomBytes(8).toString('hex')+'.tmp',f=await open(path,'wx',0o600);try{await f.writeFile(JSON.stringify({schema:1,projects}));await f.sync();}finally{await f.close();}await rename(path,file);}
 async function context(){const saved=await workspace.read(),w=saved?.workspace;return {w,key:saved?.projectId||null,hash:w?portableHash(w.input):null};}
 const event=(p,label)=>{p.events.unshift({at:new Date().toISOString(),label});p.events=p.events.slice(0,200);p.revision++;};
 async function mutate(input,fn){return serial(async()=>{
  const {w,key,hash}=await context();if(!key)throw bad('PROJECT_NOT_SAVED',409);
  if(input.expectedProjectHash!==hash)throw bad('PROJECT_CHANGED_RELOAD',409);
  const old=projects[key]||blank();if(input.expectedRevision!==old.revision)throw bad('PRODUCTION_CHANGED_RELOAD',409);
  const next=clone(old);await fn(next,w,hash);projects[key]=next;await persist();return {...clone(next),projectHash:hash,projectId:key};
 });}
 function renderSignature(p,hash){return digest({projectHash:hash,timeline:p.timeline,reviews:p.reviews.filter(r=>r.decision==='approved').map(r=>({assetId:r.assetId,sha256:r.sha256,reviewer:r.reviewer}))});}
 function approved(p,id,hash){const a=assets.resolveAsset(id);return a&&p.reviews.some(r=>r.assetId===id&&r.sha256===a.sha256&&r.decision==='approved'&&r.projectHash===hash);}
 async function runRender(key,job,timeline){
  const temporary=join(folder,'render-'+job.id);await mkdir(temporary,{recursive:true,mode:0o700});
  try{
   const clips=[];
   for(let i=0;i<timeline.clips.length;i++){
    const c=timeline.clips[i],a=await assets.inspectAsset(c.assetId),path=assets.localPath(c.assetId),out=join(temporary,`clip-${i}.mp4`);
    const args=['-hide_banner','-loglevel','error','-nostdin','-y','-protocol_whitelist','file,pipe'];
    if(a.kind==='image')args.push('-loop','1','-i',path);else args.push('-ss',String(c.start),'-i',path);
    if(!a.hasAudio)args.push('-f','lavfi','-i','anullsrc=channel_layout=stereo:sample_rate=48000');
    args.push('-t',String(c.duration),'-map','0:v:0','-map',a.hasAudio?'0:a:0':'1:a:0','-vf','scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24','-c:v','libx264','-threads','1','-preset','veryfast','-pix_fmt','yuv420p','-c:a','aac','-ar','48000','-ac','2','-movflags','+faststart',out);
    await execImpl('ffmpeg',args,{timeout:120000,maxBuffer:200000});clips.push(out);
   }
   const list=join(temporary,'clips.txt'),h=await open(list,'wx',0o600);try{await h.writeFile(clips.map(p=>`file '${p.replace(/'/g,"'\\''")}'`).join('\n'));}finally{await h.close();}
   const output=join(folder,job.id+'.mp4'),duration=timeline.clips.reduce((n,c)=>n+c.duration,0);
   const args=['-hide_banner','-loglevel','error','-nostdin','-y','-protocol_whitelist','file,pipe','-f','concat','-safe','0','-i',list];
   if(timeline.audioAssetId)args.push('-protocol_whitelist','file,pipe','-i',assets.localPath(timeline.audioAssetId),'-map','0:v:0','-map','1:a:0','-af','apad','-t',String(duration),'-c:v','copy','-c:a','aac');
   else args.push('-c','copy');
   args.push('-movflags','+faststart',output);await execImpl('ffmpeg',args,{timeout:120000,maxBuffer:200000});await chmod(output,0o600);
   const bytes=await readFile(output);if(!bytes.length)throw bad('LOCAL_RENDER_EMPTY');
   await serial(async()=>{const p=projects[key],j=p.renders.find(x=>x.id===job.id);Object.assign(j,{status:'ready',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),duration,finishedAt:new Date().toISOString()});event(p,'Render film lokal selesai');await persist();});
  }catch{
   await serial(async()=>{const p=projects[key],j=p.renders.find(x=>x.id===job.id);j.status='failed';j.errorCode='LOCAL_RENDER_FAILED_CHECK_FFMPEG_AND_MEDIA';event(p,'Render lokal gagal; aset sumber tetap tersimpan');await persist();});
  }finally{await rm(temporary,{recursive:true,force:true});renderSources.clear();renderBusy=false;}
 }
 const api={
  async init(){await mkdir(folder,{recursive:true,mode:0o700});try{const d=JSON.parse(await readFile(file,'utf8'));if(d.schema!==1||!d.projects||Array.isArray(d.projects))throw bad('PRODUCTION_STORE_INVALID');projects=d.projects;let changed=false;for(const p of Object.values(projects))for(const j of p.renders||[])if(j.status==='rendering'){j.status='interrupted';j.errorCode='LOCAL_RENDER_INTERRUPTED';changed=true;}if(changed)await persist();}catch(e){if(e.code!=='ENOENT')throw e;await persist();}},
  isRenderSource(id){return renderSources.has(id);},
  async pruneMissingAssets(){return serial(async()=>{
   const next={...projects};
   let changed=false;
   for(const [key,p] of Object.entries(projects)){
    const reviews=p.reviews.filter(r=>assets.resolveAsset(r.assetId));
    const clips=p.timeline.clips.filter(c=>assets.resolveAsset(c.assetId));
    const audioAssetId=assets.resolveAsset(p.timeline.audioAssetId)?p.timeline.audioAssetId:null;
    if(reviews.length===p.reviews.length&&clips.length===p.timeline.clips.length&&audioAssetId===p.timeline.audioAssetId)continue;
    next[key]={...p,reviews,timeline:{clips,audioAssetId},events:[...p.events]};
    event(next[key],'Referensi aset yang sudah dihapus dilepas dari proyek');
    changed=true;
   }
   if(changed){
    const previous=projects;projects=next;
    try{await persist();}catch(error){projects=previous;throw error;}
   }
  });},
  async state(){await chain;const {w,key,hash}=await context(),p=clone(projects[key]||blank());const signature=renderSignature(p,hash);return {...p,projectHash:hash,projectId:key,projectName:w?.input.projectName||null,shotCount:w?.plan.shots.length||0,approvedAssets:p.reviews.filter(r=>approved(p,r.assetId,hash)).length,renders:p.renders.map(j=>({...j,current:j.signature===signature})),paidCalls:0};},
  async brief(input){return mutate(input,(p,w)=>{
   if(!['image','motion'].includes(input.kind))throw bad('BRIEF_KIND_INVALID');
   const prompt=text(input.prompt,4000),shotId=input.shotId?text(input.shotId,80):null;if(shotId&&!w.plan.shots.some(s=>s.id===shotId))throw bad('SHOT_NOT_FOUND');
   if(p.briefs.length>=200)throw bad('BRIEF_LIMIT');p.briefs.unshift({id:randomBytes(12).toString('hex'),kind:input.kind,prompt,shotId,createdAt:new Date().toISOString()});event(p,'Draf '+(input.kind==='image'?'gambar':'gerak')+' disimpan');
  });},
  async review(input){return mutate(input,async(p,w,hash)=>{
   const a=await assets.inspectAsset(input.assetId);if(!['approved','revision'].includes(input.decision))throw bad('REVIEW_DECISION_INVALID');
   const review={projectHash:hash,assetId:a.id,sha256:a.sha256,decision:input.decision,reviewer:text(input.reviewer,80),note:text(input.note??'',1000,true),at:new Date().toISOString()};
   p.reviews=p.reviews.filter(r=>r.assetId!==a.id);p.reviews.push(review);event(p,`${review.reviewer}: ${a.name} — ${review.decision==='approved'?'disetujui':'perlu revisi'}`);
  });},
  async timeline(input){return mutate(input,async p=>{
   if(!Array.isArray(input.clips)||input.clips.length>24)throw bad('TIMELINE_INVALID');
   const clips=[];for(const c of input.clips){const a=await assets.inspectAsset(c.assetId);if(!['image','video'].includes(a.kind)||!Number.isFinite(c.start)||c.start<0||!Number.isFinite(c.duration)||c.duration<1||c.duration>60||(a.kind==='video'&&c.start+c.duration>a.durationSeconds+0.1)||(a.kind==='image'&&c.start!==0))throw bad('CLIP_RANGE_INVALID');clips.push({assetId:a.id,start:c.start,duration:c.duration});}
   if(clips.reduce((n,c)=>n+c.duration,0)>300)throw bad('TIMELINE_MAX_300_SECONDS');
   const audioAssetId=input.audioAssetId||null;if(audioAssetId&&(await assets.inspectAsset(audioAssetId)).kind!=='audio')throw bad('AUDIO_ASSET_REQUIRED');
   p.timeline={clips,audioAssetId};event(p,'Susunan film lokal disimpan');
  });},
  async render(input){
   if(renderBusy)throw bad('RENDER_BUSY',409);let start,acquired=false;
   const state=await mutate(input,(p,w,hash)=>{if(renderBusy)throw bad('RENDER_BUSY',409);if(!p.timeline.clips.length)throw bad('TIMELINE_EMPTY');for(const id of [...p.timeline.clips.map(c=>c.assetId),...(p.timeline.audioAssetId?[p.timeline.audioAssetId]:[])])if(!approved(p,id,hash))throw bad('MEDIA_REVIEW_REQUIRED',409);
    const job={id:randomBytes(12).toString('hex'),status:'rendering',signature:renderSignature(p,hash),projectHash:hash,createdAt:new Date().toISOString(),source:'local_edit',paidCalls:0};p.renders.unshift(job);p.renders=p.renders.slice(0,30);event(p,'Render film lokal dimulai');start={job,timeline:clone(p.timeline)};for(const clip of p.timeline.clips)renderSources.add(clip.assetId);
    if(p.timeline.audioAssetId)renderSources.add(p.timeline.audioAssetId);
    renderBusy=true;acquired=true;
   }).catch(e=>{if(acquired){renderBusy=false;renderSources.clear();}throw e;});
   void runRender(state.projectId,start.job,start.timeline);return state;
  },
  async media(id){if(!/^[a-f0-9]{24}$/.test(id))throw bad('RENDER_NOT_FOUND',404);const {key}=await context(),p=projects[key],j=p?.renders.find(x=>x.id===id&&x.status==='ready');if(!j)throw bad('RENDER_NOT_FOUND',404);const path=join(folder,id+'.mp4'),s=await stat(path);if(s.size!==j.bytes)throw bad('RENDER_INTEGRITY_FAILED',409);return {path,size:s.size,stream:createReadStream(path)};},
  async exportState(){const s=await api.state();return {briefs:s.briefs,reviews:s.reviews,timeline:s.timeline,events:s.events};},
  async importState(key,data){return serial(async()=>{const p={...blank(),...clone(data),renders:[]};p.revision=(projects[key]?.revision||0)+1;event(p,'Paket proyek diimpor — review perlu dikonfirmasi penerima');projects[key]=p;await persist();});}
 };
 return api;
}
