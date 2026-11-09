/** AIIDE model-specific requests. Transport is injected for offline contract tests.
 * No retries on ambiguous paid POSTs. Secrets never enter return values.
 */
import {AIIDE_MODELS,AIIDE_ORIGIN} from './aiide-video-plan.mjs';
export const AIIDE_VIDEO_CREATE='https://www.aiide.com/v1/videos';
export const AIIDE_VIDEO_STATUS='https://www.aiide.com/v1/video/generations/';
const taskId=/^[a-zA-Z0-9][a-zA-Z0-9._-]{3,180}$/;
const statusMap={NOT_START:'queued',SUBMITTED:'queued',QUEUED:'queued',IN_PROGRESS:'running',RUNNING:'running',SUCCESS:'succeeded',SUCCEEDED:'succeeded',COMPLETED:'succeeded',FAILURE:'failed',FAILED:'failed',EXPIRED:'expired',CANCELLED:'cancelled',CANCELED:'cancelled',UNKNOWN:'unknown'};
export class AiideVideoError extends Error {
 constructor(code,status=null){super(code);this.code=code;this.status=status;}
}
async function responseJson(response){
 const type=(response.headers?.get('content-type')||'').split(';')[0].trim().toLowerCase();
 if(type!=='application/json')throw new AiideVideoError('AIIDE_RESPONSE_NOT_JSON',response.status);
 const reader=response.body?.getReader?.();if(!reader)throw new AiideVideoError('AIIDE_EMPTY_RESPONSE',response.status);
 const buffers=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536)throw new AiideVideoError('AIIDE_RESPONSE_TOO_LARGE',response.status);buffers.push(Buffer.from(value));}}
 finally{reader.releaseLock();}
 try{return JSON.parse(Buffer.concat(buffers).toString('utf8'));}catch{throw new AiideVideoError('AIIDE_BAD_JSON',response.status);}
}
export function compileAiideVideoPayload(plan){
 const model=AIIDE_MODELS.find(m=>m.id===plan?.model);
 if(plan?.contract!=='aiide-public-2026-11-08'||!model?.modes.includes(plan.mode)||plan.payload?.model!==model.id||typeof plan.payload?.prompt!=='string'||JSON.stringify(plan.payload).includes('LOCAL_ASSET_NOT_STAGED:'))throw new AiideVideoError('AIIDE_PAYLOAD_INVALID');
 return structuredClone(plan.payload);
}
export function createAiideVideoAdapter({apiKey,fetchImpl=fetch,networkAllowed=false,timeoutMs=30000,modelId=null}={}){
 if(typeof apiKey!=='string'||apiKey.trim().length<12)throw new AiideVideoError('AIIDE_KEY_REQUIRED');
 if(typeof fetchImpl!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>120000)throw new AiideVideoError('AIIDE_ADAPTER_INVALID');
 const statusModel=modelId===null?null:AIIDE_MODELS.find(m=>m.id===modelId);
 if(modelId!==null&&!statusModel)throw new AiideVideoError('AIIDE_MODEL_NOT_DOCUMENTED');
 const statusEndpoint=(statusModel?.origin||AIIDE_ORIGIN)+'/v1/video/generations/';
 const headers=()=>({authorization:`Bearer ${apiKey}`,'content-type':'application/json',accept:'application/json'});
 return Object.freeze({
  async submit(plan){
   if(!networkAllowed)throw new AiideVideoError('AIIDE_NETWORK_DISABLED');
   const payload=compileAiideVideoPayload(plan);
   let r;try{r=await fetchImpl((AIIDE_MODELS.find(m=>m.id===plan.model).origin||AIIDE_ORIGIN)+(['sora','veo'].includes(AIIDE_MODELS.find(m=>m.id===plan.model).family)?'/v1/videos':'/v1/video/generations'),{method:'POST',headers:headers(),body:JSON.stringify(payload),redirect:'manual',signal:AbortSignal.timeout(timeoutMs)});}catch{throw new AiideVideoError('AIIDE_SUBMISSION_UNKNOWN');}
   let data;try{data=await responseJson(r);}catch{throw new AiideVideoError('AIIDE_SUBMISSION_UNKNOWN',r.status);}
   const id=data?.task_id||data?.id||data?.data?.task_id;
   if(r.status>=200&&r.status<300&&taskId.test(id||''))return {providerTaskId:id};
   // Do not repeat paid POST even after HTTP 4xx — provider may have accepted it.
   throw new AiideVideoError('AIIDE_SUBMISSION_UNKNOWN',r.status);
  },
  async getStatus(id){
   if(!networkAllowed)throw new AiideVideoError('AIIDE_NETWORK_DISABLED');
   if(!taskId.test(id||''))throw new AiideVideoError('AIIDE_TASK_ID_INVALID');
   let r;try{r=await fetchImpl(statusEndpoint+encodeURIComponent(id),{method:'GET',headers:headers(),redirect:'manual',signal:AbortSignal.timeout(timeoutMs)});}catch{throw new AiideVideoError('AIIDE_POLL_UNAVAILABLE');}
   if(!r.ok)throw new AiideVideoError('AIIDE_POLL_UNAVAILABLE',r.status);
   const data=await responseJson(r);
   // AIIDE returns both its outer task status and (for some upstreams) a nested status.
   // Prefer the upstream status when present; otherwise use the documented outer status.
   const raw=data?.data?.data?.status??data?.data?.status??data?.status;
   const state=statusMap[String(raw??'').toUpperCase()];
   if(!state||state==='unknown')throw new AiideVideoError('AIIDE_STATUS_UNRECOGNIZED');
   const nested=data?.data?.data||{};
   // AIIDE's documented response puts video_url inside data.data, while some
   // channels may use data.result_url; never expose signed URLs in API responses.
   const url=nested.content?.video_url||nested.output?.video_url||nested.result?.video_url||nested.result?.download_url||nested.result?.url||nested.metadata?.video_url||nested.metadata?.download_url||nested.metadata?.url||nested.video_url||nested.download_url||nested.url||data?.data?.result_url||data?.data?.video_url||data?.data?.download_url||data?.result_url||data?.video_url||null;
   return {state,videoUrl:typeof url==='string'?url:null};
  }
 });
}
