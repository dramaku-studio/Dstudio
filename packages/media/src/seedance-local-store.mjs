/** Private, loopback-only Seedance draft/asset storage. NOT production object storage. */
import {mkdir,readFile,writeFile,rename,open,lstat,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {compileSeedanceRequest} from '../../providers/src/seedance.mjs';
import {compileAiideRequest,validateProviderReference} from '../../providers/src/aiide-video-plan.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
const validId=/^[a-f0-9]{24}$/;
export class AssetValidationError extends Error {constructor(code){super(code);this.code=code;this.status=422;}}
function sniff(bytes){
 if(bytes.length<12)throw new AssetValidationError('MEDIA_TOO_SMALL');
 if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {kind:'image',mime:'image/png',ext:'png',max:10*1024*1024};
 if(bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return {kind:'image',mime:'image/jpeg',ext:'jpg',max:10*1024*1024};
 if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return {kind:'image',mime:'image/webp',ext:'webp',max:10*1024*1024};
 if(bytes.toString('ascii',4,8)==='ftyp'){const major=bytes.toString('ascii',8,12);if(['isom','iso2','mp41','mp42','avc1','M4V ','qt  '].includes(major))return {kind:'video',mime:'video/mp4',ext:'mp4',max:20*1024*1024};}
 if(bytes.toString('ascii',0,3)==='ID3'||(bytes[0]===0xff&&(bytes[1]&0xe0)===0xe0))return {kind:'audio',mime:'audio/mpeg',ext:'mp3',max:10*1024*1024};
 if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WAVE')return {kind:'audio',mime:'audio/wav',ext:'wav',max:10*1024*1024};
 throw new AssetValidationError('UNSUPPORTED_MEDIA_SIGNATURE');
}
export function createSeedanceLocalStore({root,clock=Date.now}={}){
 if(typeof root!=='string'||!root.trim())throw Error('PRIVATE_ASSET_ROOT_REQUIRED');
 const folder=resolve(root),idx=join(folder,'index.json');let assets=[],jobs=[],pending=[],chain=Promise.resolve();
 async function persist(nextAssets=assets,nextPending=pending){const tmp=join(folder,`index-${randomBytes(8).toString('hex')}.tmp`);await writeFile(tmp,JSON.stringify({schema:1,assets:nextAssets,jobs,pending:nextPending}),{mode:0o600,flag:'wx'});await rename(tmp,idx);}
 const serialize=fn=>{const task=chain.then(fn);chain=task.catch(()=>{});return task;};
 const expiresAt=asset=>Date.parse(asset.createdAt)+72*60*60*1000;
 async function removeFiles(ids){
  if(ids.length){
   const removed=new Set(ids),next=assets.filter(asset=>!removed.has(asset.id)),todo=[...new Set([...pending,...ids])];
   await persist(next,todo);
   assets=next;pending=todo;
  }
  if(!pending.length)return;
  for(const id of pending){
   if(!validId.test(id))throw Error('INVALID_LOCAL_INDEX');
   await rm(join(folder,id+'.bin'),{force:true});
  }
  await persist(assets,[]);
  pending=[];
 }
 return Object.freeze({
 async init(){await mkdir(folder,{recursive:true,mode:0o700});try{const state=JSON.parse(await readFile(idx,'utf8'));if(state.schema!==1||!Array.isArray(state.assets)||!Array.isArray(state.jobs))throw Error('INVALID_LOCAL_INDEX');assets=state.assets;jobs=state.jobs;pending=state.pending??[];if(!Array.isArray(pending)||pending.some(id=>typeof id!=='string'||!validId.test(id)))throw Error('INVALID_LOCAL_INDEX');}catch(e){if(e.code!=='ENOENT')throw e;await persist();}},
 listAssets(){return structuredClone(assets).reverse().map(asset=>({...asset,expiresAt:new Date(expiresAt(asset)).toISOString()}));},
 async expireAssets(inUse=()=>false){return serialize(()=>removeFiles(assets.filter(a=>expiresAt(a)<=clock()&&!inUse(a.id)).map(a=>a.id)));},
 async removeAsset(id,projectId){return serialize(async()=>{
  const found=this.resolveAsset(id);
  if(!found||(found.projectId&&found.projectId!==projectId))throw new AssetValidationError('ASSET_NOT_FOUND');
  await removeFiles([id]);
 });},
 resolveAsset(id){return validId.test(String(id))?assets.find(x=>x.id===id):null;},
 async addAsset(bytes,name,{projectId=null,generatedJobId=null,fromPackage=false}={}){return serialize(async()=>{
  if(generatedJobId&&!validId.test(generatedJobId))throw new AssetValidationError('INVALID_JOB_ID');
  const existing=generatedJobId&&assets.find(a=>a.generatedJobId===generatedJobId&&a.projectId===projectId);
  if(existing)return structuredClone(existing);
  const maxBytes=(generatedJobId?120:fromPackage?64:20)*1024*1024;
  if(!Buffer.isBuffer(bytes)||bytes.length>maxBytes||bytes.length<12)throw new AssetValidationError('ASSET_SIZE_INVALID');
  const type=sniff(bytes);if(bytes.length>(type.kind==='video'?maxBytes:type.max))throw new AssetValidationError('ASSET_TOO_LARGE');
  if(assets.length>=250||assets.reduce((total,a)=>total+a.bytes,0)+bytes.length>500*1024*1024)throw new AssetValidationError('LOCAL_STORAGE_QUOTA');
  if(typeof name!=='string'||!name.trim()||name.length>180)throw new AssetValidationError('INVALID_ASSET_NAME');
  const clean=name.replace(/[\x00-\x1f\x7f]/g,'').split(/[\\/]/).pop().slice(0,120)||'attachment';
  const id=randomBytes(12).toString('hex'),path=join(folder,id+'.bin');
  const f=await open(path,'wx',0o600);try{await f.writeFile(bytes);}finally{await f.close();}
  const asset={id,name:clean,kind:type.kind,mime:type.mime,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),createdAt:new Date(clock()).toISOString(),projectId,...(generatedJobId?{generatedJobId}:{})};
  const next=[...assets,asset];
  try{await persist(next);}catch(e){await rm(path,{force:true});throw e;}
  assets=next;return structuredClone(asset);
 });},
 async inspectAsset(id){
  const asset=this.resolveAsset(id);if(!asset)throw new AssetValidationError('ASSET_NOT_FOUND');
  await this.readAsset(id);
  if(asset.inspected)return structuredClone(asset);
  try{
   const {stdout}=await exec('ffprobe',['-v','error','-protocol_whitelist','file,pipe','-show_streams','-show_format','-of','json',join(folder,id+'.bin')],{timeout:12000,maxBuffer:1000000});
   const data=JSON.parse(stdout),stream=data.streams?.find(s=>s.codec_type===(asset.kind==='audio'?'audio':'video'));
   if(!stream)throw Error('No media stream');
   if(asset.mime==='audio/mpeg'&&stream.codec_name!=='mp3')throw Error('Not an MP3 stream');
   const duration=Number(data.format?.duration||stream.duration||0),[num,den]=String(stream.avg_frame_rate||'0/1').split('/').map(Number);
   if(asset.kind!=='image'&&(!Number.isFinite(duration)||duration<=0||duration>600))throw Error('Duration invalid');
   Object.assign(asset,{inspected:true,width:stream.width||null,height:stream.height||null,durationSeconds:asset.kind==='image'?null:duration,fps:den?num/den:0,hasAudio:data.streams.some(s=>s.codec_type==='audio')});
   await serialize(()=>persist());return structuredClone(asset);
  }catch{throw new AssetValidationError('MEDIA_UNREADABLE_OR_FFPROBE_MISSING');}
 },
 async bindReference(id,value){return serialize(async()=>{
  const a=this.resolveAsset(id);if(!a)throw new AssetValidationError('ASSET_NOT_FOUND');
  const ref=value===''?null:validateProviderReference(value);a.providerReference=ref;await persist();return structuredClone(a);
 });},
 async readAsset(id){const asset=this.resolveAsset(id);if(!asset)throw new AssetValidationError('ASSET_NOT_FOUND');const path=join(folder,asset.id+'.bin'),s=await lstat(path);if(!s.isFile()||s.isSymbolicLink()||s.size!==asset.bytes)throw new AssetValidationError('ASSET_INTEGRITY_FAILED');const bytes=await readFile(path);if(createHash('sha256').update(bytes).digest('hex')!==asset.sha256)throw new AssetValidationError('ASSET_INTEGRITY_FAILED');return {asset,bytes};},
 listJobs(){return jobs.slice(-100).reverse().map(j=>({id:j.id,provider:j.provider||'volcengine',projectId:j.projectId||null,model:j.model,mode:j.mode,status:j.status,requestHash:j.requestHash,createdAt:j.createdAt,attachmentCount:j.attachmentCount,paidCalls:j.paidCalls}));},
 async createJob(input,{provider='volcengine',projectId=null}={}){return serialize(async()=>{
  const c=(provider==='aiide'?compileAiideRequest:compileSeedanceRequest)(input,id=>this.resolveAsset(id));const job={id:randomBytes(12).toString('hex'),provider,projectId,model:c.model,mode:c.mode,status:c.status,requestHash:c.requestHash,createdAt:new Date().toISOString(),attachmentCount:c.attachmentCount,paidCalls:0,request:c.input||{prompt:input.prompt,promptLanguage:input.promptLanguage??'id',model:input.model,mode:input.mode,resolution:input.resolution,ratio:input.ratio,duration:input.duration,generateAudio:input.generateAudio??true,watermark:input.watermark??false,draft:input.draft??false,...(input.seed===undefined?{}:{seed:input.seed}),assets:input.assets??[]},warnings:c.warnings};
  if(jobs.length>=1000)throw new AssetValidationError('LOCAL_JOB_LIMIT');jobs.push(job);await persist();return {job,plan:c};
 });},
 async getJob(id){if(!validId.test(String(id)))throw new AssetValidationError('JOB_NOT_FOUND');const j=jobs.find(x=>x.id===id);if(!j)throw new AssetValidationError('JOB_NOT_FOUND');return structuredClone(j);},
 localPath(id){const a=this.resolveAsset(id);if(!a)throw new AssetValidationError('ASSET_NOT_FOUND');return join(folder,a.id+'.bin');}
 });
}
