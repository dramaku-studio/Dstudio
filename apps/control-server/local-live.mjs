/**
 * Dramasaku Local Live Pilot — one-shot, opt-in Seedance text-to-video.
 * This is a SINGLE-OPERATOR local pilot, not a production scheduler or a spend-cap system.
 * POST ambiguity remains blocked for manual provider reconciliation; no automatic paid retries.
 */
import {mkdir, readFile, writeFile, rename, open, stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {join, resolve} from 'node:path';
import {createHash, randomBytes} from 'node:crypto';
import {compileSeedanceRequest} from '../../packages/providers/src/seedance.mjs';
import {createSeedanceLasAdapter} from '../../packages/providers/src/seedance-las-adapter.mjs';
import {createLocalVideoStore} from '../../packages/media/src/local-store.mjs';

const ID=/^[a-f0-9]{24}$/;
const TODAY=()=>new Date().toISOString().slice(0,10);
const fail=(code,status=422)=>Object.assign(new Error(code),{code,status});
const states=new Set(['submission_unknown','submitted','queued','running','succeeded','failed','expired','cancelled','download_pending','ready']);

export function approvedMediaURL(raw,allowedHosts=['.tos-cn-beijing.volces.com','.tos-ap-southeast-1.volces.com']){
 let u;try{u=new URL(raw);}catch{throw fail('RESULT_URL_REJECTED');}
 if(u.protocol!=='https:'||u.username||u.password||u.port||!allowedHosts.some(s=>u.hostname.endsWith(s)&&u.hostname.length>s.length))throw fail('RESULT_URL_REJECTED');
 if(!u.pathname.toLowerCase().endsWith('.mp4'))throw fail('RESULT_URL_REJECTED');
 return u;
}
export function createLocalLiveEngine({root,loadApiKey,fetchImpl=fetch,enabled=false,capabilityVerified=false,maxDaily=1,clock=TODAY,allowedMediaHosts}={}){
 if(typeof root!=='string'||!root.trim())throw fail('LIVE_ROOT_REQUIRED');
 if(typeof loadApiKey!=='function')throw fail('LIVE_KEY_SOURCE_REQUIRED');
 if(typeof fetchImpl!=='function')throw fail('LIVE_FETCH_REQUIRED');
 if(!Number.isInteger(maxDaily)||maxDaily<1||maxDaily>5)throw fail('LIVE_DAILY_CAP_INVALID');
 const folder=resolve(root),index=join(folder,'live-jobs.json');
 const media=createLocalVideoStore({root:join(folder,'results'),maxBytes:120*1024*1024,requireFfprobe:true});
 let entries=[],ready=false,queue=Promise.resolve();
 const serial=fn=>{const r=queue.then(fn);queue=r.catch(()=>{});return r;};
 const publicJob=j=>({id:j.id,createdAt:j.createdAt,model:j.model,mode:j.mode,status:j.status,requestHash:j.requestHash,providerTaskId:j.providerTaskId||null,mediaSha256:j.mediaSha256||null,mediaBytes:j.mediaBytes||null,mediaDuration:j.mediaDuration||null,updatedAt:j.updatedAt,errorCode:j.errorCode||null});
 const save=async()=>{
  const tmp=join(folder,`.live-jobs-${randomBytes(8).toString('hex')}.tmp`);
  await writeFile(tmp,JSON.stringify({schema:1,entries}),{flag:'wx',mode:0o600});
  await rename(tmp,index);
 };
 const adapter=async()=>{
  const key=await loadApiKey();if(!key)throw fail('SEEDANCE_API_KEY_REQUIRED',409);
  return createSeedanceLasAdapter({apiKey:key,fetchImpl,networkAllowed:enabled,timeoutMs:30000});
 };
 const find=id=>{if(!ID.test(String(id)))throw fail('JOB_NOT_FOUND',404);const j=entries.find(x=>x.id===id);if(!j)throw fail('JOB_NOT_FOUND',404);return j;};
 const available=()=>enabled;
 function requireReady(){if(!ready)throw fail('LOCAL_LIVE_NOT_INITIALIZED',503);}
 return Object.freeze({
  async init(){await mkdir(folder,{recursive:true,mode:0o700});try{
   const s=await stat(index);if(!s.isFile()||s.size>2_000_000)throw fail('LIVE_INDEX_INVALID');
   const d=JSON.parse(await readFile(index,'utf8'));if(d.schema!==1||!Array.isArray(d.entries)||d.entries.length>2000||d.entries.some(j=>!ID.test(j.id)||!states.has(j.status)))throw fail('LIVE_INDEX_INVALID');
   entries=d.entries;
  }catch(e){if(e.code!=='ENOENT')throw e;await save();}ready=true;},
  async list(){requireReady();const configured=!!(await loadApiKey());const day=clock();return {enabled:available(),configured,mode:'manual_local_pilot',capabilityVerified:capabilityVerified===true,maxDaily,usedToday:entries.filter(x=>x.createdAt.slice(0,10)===day).length,quotaType:'local_submission_count_not_provider_balance',costEstimate:'unknown_provider_billing',autoRetry:false,jobs:entries.slice(-40).reverse().map(publicJob)};},
  async submit({input,consent}={}){requireReady();if(!enabled)throw fail('LIVE_TEST_DISABLED',403);
   if(capabilityVerified!==true)throw fail('PROVIDER_CAPABILITY_NOT_VERIFIED',403);
   if(consent!=='I_ACCEPT_PROVIDER_CHARGES')throw fail('PAID_CONSENT_REQUIRED',403);
   const plan=compileSeedanceRequest(input,()=>null);
   // Initial direct live pilot cannot stage private references on a cloud URL.
   if(plan.mode!=='text_to_video'||plan.attachmentCount!==0)throw fail('LIVE_PILOT_TEXT_ONLY',422);
   return serial(async()=>{
     const day=clock();if(entries.filter(x=>x.createdAt.slice(0,10)===day).length>=maxDaily)throw fail('DAILY_LOCAL_TEST_LIMIT',429);
     if(entries.some(x=>x.requestHash===plan.requestHash&&x.createdAt.slice(0,10)===day))throw fail('DUPLICATE_SAME_DAY',409);
     const api=await adapter();
     const id=randomBytes(12).toString('hex'),now=new Date().toISOString();
     const job={id,model:plan.model,mode:plan.mode,requestHash:plan.requestHash,status:'submission_unknown',createdAt:now,updatedAt:now};
     entries.push(job);await save(); // durable before billable POST; crash is UNKNOWN, not safe to retry.
     try{
       const outcome=await api.submit(plan.payload,{approved:true,capabilityVerified:true,budgetReservationId:`local-${id}`,policySnapshotHash:plan.requestHash});
       job.providerTaskId=outcome.providerTaskId;job.status='submitted';job.updatedAt=new Date().toISOString();await save();
     }catch(e){job.errorCode=e.code||'SUBMISSION_UNKNOWN';job.status='submission_unknown';job.updatedAt=new Date().toISOString();await save();}
     return publicJob(job);
   });
  },
  async check(id){requireReady();if(!enabled)throw fail('LIVE_TEST_DISABLED',403);
   return serial(async()=>{
     const job=find(id);if(['submission_unknown','ready','failed','expired','cancelled'].includes(job.status))throw fail(job.status==='submission_unknown'?'MANUAL_PROVIDER_RECONCILIATION_REQUIRED':'JOB_NOT_POLLABLE',409);
     if(!job.providerTaskId)throw fail('TASK_ID_MISSING',409);
     const api=await adapter();let status;
     try{status=await api.getStatus(job.providerTaskId);}catch(e){throw fail(e.code||'PROVIDER_STATUS_UNAVAILABLE',503);}
     const state=status.state;
     if(!['queued','running','succeeded','failed','expired','cancelled'].includes(state))throw fail('UNSUPPORTED_TASK_STATUS',502);
     job.status=state;job.updatedAt=new Date().toISOString();await save();
     if(state==='succeeded'){
       job.status='download_pending';await save();
       const url=status.taskMetadata?.content?.video_url;
       if(typeof url!=='string'){job.errorCode='NO_OUTPUT_URL';await save();return publicJob(job);}
       try{
         const u=approvedMediaURL(url,allowedMediaHosts);
         const r=await fetchImpl(u.href,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(120000),headers:{accept:'video/mp4'}});
         if(r.status!==200||!r.body||(!['video/mp4','application/octet-stream'].includes((r.headers.get('content-type')||'').split(';')[0].trim().toLowerCase())))throw fail('VIDEO_FETCH_FAILED',502);
         const rawLength=r.headers.get('content-length');const length=rawLength===null?null:Number(rawLength);
         const result=await media.ingest({stream:r.body,length});
         job.status='ready';job.mediaSha256=result.sha256;job.mediaBytes=result.bytes;job.mediaDuration=result.durationSeconds;job.errorCode=null;job.updatedAt=new Date().toISOString();await save();
       }catch(e){job.errorCode=e.code||'VIDEO_INGEST_FAILED';job.updatedAt=new Date().toISOString();await save();}
     }
     return publicJob(job);
   });
  },
  // Completed provider jobs may be re-checked to retry only safe GET/download, never POST.
  async retryDownload(id){requireReady();const j=find(id);if(j.status!=='download_pending')throw fail('DOWNLOAD_RETRY_NOT_ALLOWED',409);
    j.status='submitted';await save();return this.check(id);
  },
  async mediaPath(id){requireReady();const j=find(id);if(j.status!=='ready'||!/^[0-9a-f]{64}$/.test(j.mediaSha256||''))throw fail('MEDIA_NOT_READY',404);
    const path=join(folder,'results',`${j.mediaSha256}.mp4`);const s=await stat(path);if(!s.isFile()||s.size!==j.mediaBytes)throw fail('MEDIA_INTEGRITY_FAILURE',409);
    return {path,size:s.size,stream:createReadStream(path)};
  }
 });
}
