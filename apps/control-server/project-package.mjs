/** Portable, bounded team project. Never includes keys, provider task IDs or signed URLs. */
import {mkdir,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {validateCreativeProject,portableHash} from './workspace.mjs';
import {compileAiideRequest} from '../../packages/providers/src/aiide-video-plan.mjs';
import {compileSpeechInput} from './tts-engine.mjs';
import {createSeedanceLocalStore} from '../../packages/media/src/seedance-local-store.mjs';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const sha=b=>createHash('sha256').update(b).digest('hex');
const bad=(code,status=422)=>Object.assign(new Error(code),{code,status});
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join(',')===keys.sort().join(',');
const id=/^[a-f0-9]{24}$/;
function validate(bundle){
 if(!exact(bundle,['kind','version','exportedAt','payload','sha256'])||bundle.kind!=='studio.internal-project'||bundle.version!==1||hash(bundle.payload)!==bundle.sha256)throw bad('PACKAGE_INTEGRITY_INVALID');
 const p=bundle.payload;if(!exact(p,['projectId','creative','production','assets','videoDrafts','voiceDrafts'])||!/^[a-f0-9]{32,64}$/.test(p.projectId))throw bad('PACKAGE_INVALID');
 const w=validateCreativeProject(p.creative);
 if(!Array.isArray(p.assets)||p.assets.length>100||!Array.isArray(p.videoDrafts)||p.videoDrafts.length>100||!Array.isArray(p.voiceDrafts)||p.voiceDrafts.length>200)throw bad('PACKAGE_LIMIT');
 let total=0;const registry=new Map();
 for(const a of p.assets){
  if(!exact(a,['id','name','kind','sha256','data'])||!id.test(a.id)||registry.has(a.id)||typeof a.name!=='string'||!a.name.trim()||a.name.length>120||!['image','video','audio'].includes(a.kind)||typeof a.data!=='string'||a.data.length>28_000_000)throw bad('PACKAGE_ASSET_INVALID');
  const bytes=Buffer.from(a.data,'base64');total+=bytes.length;if(bytes.toString('base64')!==a.data||bytes.length<12||sha(bytes)!==a.sha256||total>64*1024*1024)throw bad('PACKAGE_ASSET_INTEGRITY');registry.set(a.id,a);
 }
 const ps=p.production;if(!exact(ps,['briefs','reviews','timeline','events'])||!Array.isArray(ps.briefs)||ps.briefs.length>200||!Array.isArray(ps.reviews)||ps.reviews.length>100||!Array.isArray(ps.events)||ps.events.length>200||!exact(ps.timeline,['clips','audioAssetId'])||!Array.isArray(ps.timeline.clips)||ps.timeline.clips.length>24)throw bad('PACKAGE_PRODUCTION_INVALID');
 for(const b of ps.briefs)if(!exact(b,['id','kind','prompt','shotId','createdAt'])||!id.test(b.id)||!['image','motion'].includes(b.kind)||typeof b.prompt!=='string'||!b.prompt.trim()||b.prompt.length>4000||(b.shotId&&!w.plan.shots.some(s=>s.id===b.shotId)))throw bad('PACKAGE_BRIEF_INVALID');
 for(const r of ps.reviews)if(!exact(r,['projectHash','assetId','sha256','decision','reviewer','note','at'])||!registry.has(r.assetId)||registry.get(r.assetId).sha256!==r.sha256||!['approved','revision'].includes(r.decision)||typeof r.reviewer!=='string'||r.reviewer.length>80||typeof r.note!=='string'||r.note.length>1000)throw bad('PACKAGE_REVIEW_INVALID');
 for(const c of ps.timeline.clips)if(!exact(c,['assetId','start','duration'])||!registry.has(c.assetId)||!Number.isFinite(c.start)||c.start<0||!Number.isFinite(c.duration)||c.duration<1||c.duration>60)throw bad('PACKAGE_TIMELINE_INVALID');
 if(ps.timeline.clips.reduce((n,c)=>n+c.duration,0)>300||(ps.timeline.audioAssetId&&!registry.has(ps.timeline.audioAssetId)))throw bad('PACKAGE_TIMELINE_INVALID');
 for(const e of ps.events)if(!exact(e,['at','label'])||typeof e.label!=='string'||e.label.length>500||typeof e.at!=='string'||!Number.isFinite(Date.parse(e.at)))throw bad('PACKAGE_EVENTS_INVALID');
 for(const draft of p.videoDrafts){const plan=compileAiideRequest(draft,id=>registry.get(id));if(!exact(draft,Object.keys(plan.input)))throw bad('PACKAGE_VIDEO_INVALID');}
 for(const draft of p.voiceDrafts){const plan=compileSpeechInput(draft);if(!exact(draft,['provider','voice','language','speed','text']))throw bad('PACKAGE_VOICE_INVALID');}
 return {payload:p,workspace:w,bytes:total};
}
export function createProjectPackages({root,workspace,assets,production,tts}){
 return {
  async export({onMissingDrafts}={}){
   const current=await workspace.read();if(!current)throw bad('PROJECT_NOT_SAVED',409);
   const creative=await workspace.exportPortable(),p=await production.exportState();
   let skipped=0;
   const drafts=[];for(const d of assets.listJobs().filter(x=>x.provider==='aiide'&&x.projectId===current.projectId)){
    const request=(await assets.getJob(d.id)).request;
    if(request.assets.every(ref=>assets.resolveAsset(ref.assetId)))drafts.push(request);else skipped++;
   }
   onMissingDrafts?.(skipped);
   const selected=new Set([...p.reviews.map(x=>x.assetId),...p.timeline.clips.map(x=>x.assetId),...(p.timeline.audioAssetId?[p.timeline.audioAssetId]:[]),...drafts.flatMap(d=>d.assets.map(x=>x.assetId)),...assets.listAssets().filter(a=>a.projectId===current.projectId).map(a=>a.id)]);
   const files=[];let size=0;for(const id of selected){const {asset,bytes}=await assets.readAsset(id);size+=bytes.length;if(size>64*1024*1024)throw bad('PACKAGE_MAX_64_MB');files.push({id:asset.id,name:asset.name,kind:asset.kind,sha256:asset.sha256,data:bytes.toString('base64')});}
   const payload={projectId:current.projectId,creative,production:p,assets:files,videoDrafts:drafts,voiceDrafts:await tts.exportDrafts(current.projectId)};
   if(files.length>100||payload.voiceDrafts.length>200)throw bad('PACKAGE_LIMIT');
   return {kind:'studio.internal-project',version:1,exportedAt:new Date().toISOString(),payload,sha256:hash(payload)};
  },
  preview(bundle){const v=validate(bundle);return {projectName:v.workspace.input.projectName,assets:v.payload.assets.length,videoDrafts:v.payload.videoDrafts.length,voiceDrafts:v.payload.voiceDrafts.length,bytes:v.bytes,reviewPolicy:'Recipient re-confirms reviews',keysIncluded:false};},
  async import({bundle,replace=false,expectedCurrentInputHash=null,expectedProductionRevision=0}={}){
   const {payload:p}=validate(bundle),current=await workspace.read(),state=await production.state();
   if((current?portableHash(current.workspace.input):null)!==expectedCurrentInputHash||state.revision!==expectedProductionRevision)throw bad('PROJECT_CHANGED_RELOAD',409);
   if(current&&!replace)throw bad('PROJECT_REPLACE_CONFIRMATION_REQUIRED',409);
   if(state.renders.some(r=>r.status==='rendering'))throw bad('RENDER_BUSY',409);
   // Decode and inspect all media before changing any active library/project record.
   const temporary=await mkdtemp(join(root,'package-stage-'));
   try{
    const stage=createSeedanceLocalStore({root:temporary});await stage.init();const staged=new Map();
    for(const a of p.assets){const added=await stage.addAsset(Buffer.from(a.data,'base64'),a.name);if(added.kind!==a.kind)throw bad('PACKAGE_ASSET_TYPE_MISMATCH');const inspected=await stage.inspectAsset(added.id);staged.set(a.id,{...inspected,id:a.id});}
    for(const d of p.videoDrafts)compileAiideRequest(d,id=>staged.get(id));
    for(const c of p.production.timeline.clips){const a=staged.get(c.assetId);if(a.kind==='audio'||(a.kind==='image'&&c.start!==0)||(a.kind==='video'&&c.start+c.duration>a.durationSeconds+0.1))throw bad('PACKAGE_TIMELINE_INVALID');}
    if(p.production.timeline.audioAssetId&&staged.get(p.production.timeline.audioAssetId).kind!=='audio')throw bad('PACKAGE_TIMELINE_INVALID');
   }finally{await rm(temporary,{recursive:true,force:true});}
   // Save a recoverable package before replacing the active project. Credentials are excluded.
   if(current){const backup=await this.export();await mkdir(join(root,'project-backups'),{recursive:true,mode:0o700});await writeFile(join(root,'project-backups',Date.now()+'-'+randomBytes(4).toString('hex')+'.studio.json'),JSON.stringify(backup),{mode:0o600,flag:'wx'});}
   const mapping=new Map(),used=new Set();
   for(const a of p.assets){const existing=assets.listAssets().find(x=>x.sha256===a.sha256&&x.projectId===p.projectId&&!used.has(x.id));const added=existing||await assets.addAsset(Buffer.from(a.data,'base64'),a.name,{projectId:p.projectId});if(added.kind!==a.kind)throw bad('PACKAGE_ASSET_TYPE_MISMATCH');await assets.inspectAsset(added.id);mapping.set(a.id,added.id);used.add(added.id);}
   const convert=id=>mapping.get(id);
   const imported=structuredClone(p.production);
   imported.reviews=imported.reviews.map(r=>({...r,assetId:convert(r.assetId),decision:'revision',note:('Impor: konfirmasi ulang review. '+r.note).slice(0,1000)}));
   imported.timeline.clips=imported.timeline.clips.map(c=>({...c,assetId:convert(c.assetId)}));
   imported.timeline.audioAssetId=imported.timeline.audioAssetId?convert(imported.timeline.audioAssetId):null;
   // Validate clip ranges before writing the production record.
   for(const c of imported.timeline.clips){const a=assets.resolveAsset(c.assetId);if(a.kind==='audio'||(a.kind==='image'&&c.start!==0)||(a.kind==='video'&&c.start+c.duration>a.durationSeconds+0.1))throw bad('PACKAGE_TIMELINE_INVALID');}
   if(imported.timeline.audioAssetId&&assets.resolveAsset(imported.timeline.audioAssetId).kind!=='audio')throw bad('PACKAGE_TIMELINE_INVALID');
   for(const d of p.videoDrafts){const input={...d,assets:d.assets.map(a=>({...a,assetId:convert(a.assetId)}))};const plan=compileAiideRequest(input,id=>assets.resolveAsset(id));if(!assets.listJobs().some(j=>j.provider==='aiide'&&j.projectId===p.projectId&&j.requestHash===plan.requestHash))await assets.createJob(input,{provider:'aiide',projectId:p.projectId});}
   const priorVoice=new Set((await tts.exportDrafts(p.projectId)).map(hash));for(const d of p.voiceDrafts)if(!priorVoice.has(hash(d)))await tts.draft(d,{projectId:p.projectId});
   await production.importState(p.projectId,imported);
   const result=await workspace.importPortable(p.creative,{replace,expectedCurrentInputHash,projectId:p.projectId});
   return {workspace:result,assets:imported.reviews.length,keysImported:false,reviewsNeedConfirmation:true};
  }
 };
}
