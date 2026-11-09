/** Local AIIDE video pilot. One paid POST per UTC day, with durable intent before dispatch.
 * Real account/model contract cannot be verified until the owner tests the key.
 */
import {mkdir,readFile,writeFile,rename,stat,lstat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {isIP} from 'node:net';
import {compileAiideRequest} from '../../packages/providers/src/aiide-video-plan.mjs';
import {createAiideVideoAdapter} from '../../packages/providers/src/aiide-video-adapter.mjs';
import {createLocalVideoStore} from '../../packages/media/src/local-store.mjs';
const bad=(code,status=422)=>Object.assign(new Error(code),{code,status});
const jobId=/^[a-f0-9]{24}$/;
const today=()=>new Date().toISOString().slice(0,10);
const done=new Set(['ready','failed','expired','cancelled']);
const importedTaskId=/^[a-zA-Z0-9][a-zA-Z0-9._-]{3,180}$/;
const accepted=new Set(['submission_unknown','submitted','queued','running','download_pending','ready','failed','expired','cancelled']);
export function approvedAiideResultUrl(value,hosts=[]){
 let u;try{u=new URL(value);}catch{throw bad('AIIDE_RESULT_URL_INVALID',502);}
 const known=hosts.filter(h=>/^[a-z0-9.-]+$/i.test(h)&&!h.startsWith('.')&&!h.endsWith('.'));
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash||isIP(u.hostname)||u.hostname==='localhost'||u.hostname.endsWith('.local')||u.hostname.endsWith('.internal')||!known.includes(u.hostname.toLowerCase())||!/^\/[\w%/.,~+@!$&'()*;=:-]+$/i.test(u.pathname))throw bad('AIIDE_RESULT_HOST_NOT_APPROVED',409);
 return u;
}
export function createAiideVideoEngine({root,keyPool,fetchImpl=fetch,enabled=false,capabilityVerified=false,activation=null,readOnlyEnabled=false,allowedMediaHosts=[],resolveAsset=()=>null,maxDaily=1,clock=today}={}){
 if(typeof root!=='string'||!root||!keyPool||typeof fetchImpl!=='function')throw bad('AIIDE_ENGINE_CONFIG_INVALID');
 if(!Number.isInteger(maxDaily)||maxDaily<1||maxDaily>5)throw bad('AIIDE_DAILY_LIMIT_INVALID');
 const folder=resolve(root),index=join(folder,'aiide-video-jobs.json');let jobs=[],initialized=false,chain=Promise.resolve();
 const serial=fn=>{const r=chain.then(fn);chain=r.catch(()=>{});return r;};
 const storage=createLocalVideoStore({root:join(folder,'mp4'),maxBytes:120*1024*1024,requireFfprobe:true});
 const pub=j=>({id:j.id,provider:'aiide',source:j.source||'local_generation',model:j.model,mode:j.mode||null,createdAt:j.createdAt,updatedAt:j.updatedAt,status:j.status,providerTaskId:j.providerTaskId||null,mediaSha256:j.mediaSha256||null,mediaBytes:j.mediaBytes||null,mediaDuration:j.mediaDuration||null,errorCode:j.errorCode||null,resultHost:j.resultHost||null});
 const ready=()=>{if(!initialized)throw bad('AIIDE_NOT_INITIALIZED',503);};
 const find=id=>{if(!jobId.test(id||''))throw bad('AIIDE_JOB_NOT_FOUND',404);const j=jobs.find(x=>x.id===id);if(!j)throw bad('AIIDE_JOB_NOT_FOUND',404);return j;};
 async function save(){const tmp=join(folder,`.aiide-${randomBytes(8).toString('hex')}.tmp`);await writeFile(tmp,JSON.stringify({version:1,jobs}),{flag:'wx',mode:0o600});await rename(tmp,index);}
 async function adapter(j){const secret=await keyPool.getForInternalTask(j.keyId,'video','aiide');return createAiideVideoAdapter({apiKey:secret,modelId:j.source==='imported'?null:j.model||null,fetchImpl,networkAllowed:enabled||!!activation||readOnlyEnabled});}
 async function accounts(){const pool=await keyPool.list();return pool.pools.find(p=>p.id==='video')?.keys.filter(k=>k.provider==='aiide'&&k.enabled)||[];}
 async function download(j,url){
  try{
   const rawHost=new URL(url).hostname.toLowerCase();j.resultHost=rawHost;
   const safe=approvedAiideResultUrl(url,allowedMediaHosts);
   const r=await fetchImpl(safe.href,{method:'GET',headers:{accept:'video/mp4'},redirect:'manual',signal:AbortSignal.timeout(120000)});
   if(r.status!==200||!r.body||!['video/mp4','application/octet-stream'].includes((r.headers.get('content-type')||'').split(';')[0].toLowerCase()))throw bad('AIIDE_VIDEO_FETCH_FAILED',502);
   const length=r.headers.get('content-length');const size=length===null?null:Number(length);
   const media=await storage.ingest({stream:r.body,length:size});j.status='ready';j.mediaSha256=media.sha256;j.mediaBytes=media.bytes;j.mediaDuration=media.durationSeconds;j.errorCode=null;
  }catch(e){j.status='download_pending';j.errorCode=e.code||'AIIDE_DOWNLOAD_FAILED';}
  j.updatedAt=new Date().toISOString();await save();return pub(j);
 }
 return Object.freeze({
  async init(){
   await mkdir(folder,{recursive:true,mode:0o700});
   try{
    const s=await lstat(index);if(!s.isFile()||s.isSymbolicLink()||s.size>2000000)throw bad('AIIDE_HISTORY_CORRUPT');
    const d=JSON.parse(await readFile(index,'utf8'));
    if(d.version!==1||!Array.isArray(d.jobs)||d.jobs.length>500||d.jobs.some(j=>!j||!jobId.test(j.id)||(!accepted.has(j.status)&&j.status!=='succeeded')))throw bad('AIIDE_HISTORY_CORRUPT');
    // Older imports could stop between provider success and download_pending.
    // Recover by polling/downloading the SAME task; never send a new paid POST.
    const recovered=d.jobs.some(j=>j.status==='succeeded');
    jobs=d.jobs.map(j=>j.status==='succeeded'?{...j,status:'download_pending',errorCode:null}:j);
    if(recovered)await save();
   }catch(e){if(e.code!=='ENOENT')throw e;await save();}
   initialized=true;
  },
  async list(){ready();const pool=await keyPool.preview('video','aiide');const keys=await accounts();const readiness=activation?await activation.status():null;return {provider:'aiide',enabled:readiness?readiness.ready:enabled,readOnlyEnabled,capabilityVerified,credentialVerified:readiness?.ready||false,activationState:readiness?.state||'manual',availableModels:readiness?.models||[],autoActivation:!!activation,configured:keys.length>0,maxDaily,usedToday:jobs.filter(j=>j.source!=='imported'&&j.createdAt.slice(0,10)===clock()).length,autoRetry:false,costEstimate:'provider_quote_required',modelCompatibility:'AIIDE public contracts 2026-11-08; local tests only, live account unverified',availableAccounts:keys.map(k=>({id:k.id,label:k.label})),jobs:jobs.slice(-30).reverse().map(pub)};},
  // Import a task already created on AIIDE. Only GET status and GET media; no billable POST.
  async importTask({providerTaskId,keyId}={}){ready();if(!readOnlyEnabled)throw bad('AIIDE_READ_ONLY_IMPORT_DISABLED',403);
   if(typeof providerTaskId!=='string'||!importedTaskId.test(providerTaskId))throw bad('AIIDE_TASK_ID_INVALID',422);
   return serial(async()=>{
    const existing=jobs.find(j=>j.providerTaskId===providerTaskId);if(existing)return pub(existing);
    if(jobs.length>=500)throw bad('AIIDE_HISTORY_FULL',409);
    const candidates=await accounts();const selected=keyId?candidates.find(k=>k.id===keyId):(candidates.length===1?candidates[0]:null);
    if(!selected)throw bad(candidates.length>1?'AIIDE_SELECT_MATCHING_ACCOUNT':'AIIDE_ACCOUNT_NOT_AVAILABLE',409);
    const secret=await keyPool.getForInternalTask(selected.id,'video','aiide');
    const a=createAiideVideoAdapter({apiKey:secret,fetchImpl,networkAllowed:true});
    // Verify visibility with the selected account before registering this task.
    const result=await a.getStatus(providerTaskId);
    const now=new Date().toISOString();const j={id:randomBytes(12).toString('hex'),model:'AIIDE existing task',source:'imported',providerTaskId,keyId:selected.id,createdAt:now,updatedAt:now,status:result.state==='succeeded'?'download_pending':result.state,errorCode:null};
    jobs.push(j);await save();
    if(result.state==='succeeded'){if(result.videoUrl)return download(j,result.videoUrl);j.errorCode='AIIDE_NO_VIDEO_URL';await save();}
    return pub(j);
   });
  },
  async submit({input,consent,expectedRequestHash}={}){ready();if(!enabled&&!activation)throw bad('AIIDE_VIDEO_DISABLED',403);if(!activation&&!capabilityVerified)throw bad('AIIDE_MODEL_PROFILE_UNVERIFIED',403);if(consent!=='I_ACCEPT_PROVIDER_CHARGES')throw bad('AIIDE_COST_CONSENT_REQUIRED',403);
   const plan=compileAiideRequest(input,resolveAsset,{forDispatch:true});
   if(expectedRequestHash!==undefined&&expectedRequestHash!==plan.requestHash)throw bad('AIIDE_REQUEST_CHANGED',409);
   return serial(async()=>{if(jobs.filter(j=>j.source!=='imported'&&j.createdAt.slice(0,10)===clock()).length>=maxDaily)throw bad('AIIDE_ONE_JOB_PER_DAY',429);
    if(jobs.some(j=>j.source!=='imported'&&j.requestHash===plan.requestHash&&j.createdAt.slice(0,10)===clock()))throw bad('AIIDE_DUPLICATE_JOB',409);
    const check=await keyPool.preview('video','aiide');if(!check.selected)throw bad('AIIDE_NO_ACTIVE_KEY',409);
    const reserved=activation?await keyPool.reserveForInternalDispatch('video','aiide',{authorize:key=>activation.authorize(key.id,plan.model)}):null;
    const now=new Date().toISOString();const job={id:randomBytes(12).toString('hex'),model:plan.model,mode:plan.mode,source:'local_generation',requestHash:plan.requestHash,createdAt:now,updatedAt:now,status:'submission_unknown'};
    jobs.push(job);await save(); // intent durable BEFORE paid call
    try{
     const dispatchKey=reserved||await keyPool.reserveForInternalDispatch('video','aiide');job.keyId=dispatchKey.keyId;await save();
     const a=createAiideVideoAdapter({apiKey:dispatchKey.secret,fetchImpl,networkAllowed:enabled||!!activation});
     const r=await a.submit(plan);job.providerTaskId=r.providerTaskId;job.status='submitted';job.errorCode=null;
    }catch(e){job.status='submission_unknown';job.errorCode=e.code||'AIIDE_SUBMISSION_UNKNOWN';}
    job.updatedAt=new Date().toISOString();await save();return pub(job);
   });
  },
  async check(id){ready();if(!enabled&&!activation&&!readOnlyEnabled)throw bad('AIIDE_STATUS_CHECK_DISABLED',403);return serial(async()=>{
   const j=find(id);if(j.status==='submission_unknown')throw bad('AIIDE_MANUAL_RECONCILIATION_REQUIRED',409);
   if(done.has(j.status))throw bad('AIIDE_JOB_NOT_POLLABLE',409);
   if(!j.providerTaskId)throw bad('AIIDE_TASK_ID_MISSING',409);
   const a=await adapter(j);const result=await a.getStatus(j.providerTaskId);
   j.updatedAt=new Date().toISOString();
   if(result.state==='succeeded'){
     j.status='download_pending';await save();
     if(!result.videoUrl){j.errorCode='AIIDE_NO_VIDEO_URL';await save();return pub(j);}
     return download(j,result.videoUrl);
   }
   j.status=result.state;j.errorCode=null;await save();return pub(j);
  });},
  async mediaPath(id){ready();const j=find(id);if(j.status!=='ready'||!/^[a-f0-9]{64}$/.test(j.mediaSha256||''))throw bad('AIIDE_MEDIA_NOT_READY',404);
   const path=join(folder,'mp4',j.mediaSha256+'.mp4'),s=await stat(path);if(!s.isFile()||s.size!==j.mediaBytes)throw bad('AIIDE_MEDIA_INVALID',409);
   return {path,size:s.size,stream:createReadStream(path)};
  }
 });
}
