/** Volcengine LAS task adapter SPIKE. Not wired to HTTP dashboard or any billable scheduler.
 * Caller MUST supply server-derived authorization and atomic hold; NEVER let browser pass permits.
 */
import {SEEDANCE_FIXED_ENDPOINT,SEEDANCE_MODELS} from './seedance.mjs';
const idRe=/^[A-Za-z0-9][A-Za-z0-9_-]{3,127}$/;
export class SeedanceProviderError extends Error {constructor(code,{ambiguous=false,status=null}={}){super(code);this.code=code;this.ambiguous=ambiguous;this.status=status;}}
export function createSeedanceLasAdapter({apiKey,fetchImpl=fetch,networkAllowed=false,timeoutMs=30000}={}){
 if(typeof apiKey!=='string'||apiKey.length<12)throw Error('API_KEY_REQUIRED');
 if(typeof fetchImpl!=='function')throw Error('FETCH_REQUIRED');
 if(!Number.isInteger(timeoutMs)||timeoutMs<500||timeoutMs>120000)throw Error('TIMEOUT_INVALID');
 const headers=()=>({'authorization':`Bearer ${apiKey}`,'content-type':'application/json','accept':'application/json'});
 async function json(r){
  const mime=r.headers?.get?.('content-type')?.split(';')[0]?.trim().toLowerCase();if(mime!=='application/json')throw new SeedanceProviderError('PROVIDER_BAD_CONTENT_TYPE',{ambiguous:true,status:r.status});
  const reader=r.body?.getReader?.();if(!reader)throw new SeedanceProviderError('PROVIDER_BODY_MISSING',{ambiguous:true,status:r.status});let n=0;const parts=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>65536)throw new SeedanceProviderError('PROVIDER_RESPONSE_TOO_LARGE',{ambiguous:true,status:r.status});parts.push(value);}}finally{reader.releaseLock();}
  try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw new SeedanceProviderError('PROVIDER_BAD_JSON',{ambiguous:true,status:r.status});}
 }
 function guard(){if(!networkAllowed)throw new SeedanceProviderError('NETWORK_DISABLED');}
 return Object.freeze({
   provider:'volcengine-las',paidAccessEnabled:networkAllowed,
   async submit(payload,permit){guard();
     if(!permit||permit.approved!==true||permit.capabilityVerified!==true||typeof permit.budgetReservationId!=='string'||permit.budgetReservationId.length<8||typeof permit.policySnapshotHash!=='string'||!/^[0-9a-f]{64}$/.test(permit.policySnapshotHash))throw new SeedanceProviderError('APPROVAL_OR_BUDGET_REQUIRED');
     if(!payload||!SEEDANCE_MODELS.some(m=>m.id===payload.model)||!Array.isArray(payload.content)||!payload.content.some(x=>x.type==='text'))throw new SeedanceProviderError('PAYLOAD_INVALID');
     const body=JSON.stringify(payload);if(body.length>65536||body.includes('LOCAL_ASSET_NOT_STAGED:'))throw new SeedanceProviderError('SECURE_ASSET_STAGING_REQUIRED');
     let r;try{r=await fetchImpl(SEEDANCE_FIXED_ENDPOINT,{method:'POST',headers:headers(),body,redirect:'manual',signal:AbortSignal.timeout(timeoutMs)});}catch{throw new SeedanceProviderError('SUBMISSION_UNKNOWN',{ambiguous:true});}
     // No blind retries, even on non-2xx status, as provider may have accepted the task.
     let out;try{out=await json(r);}catch{throw new SeedanceProviderError('SUBMISSION_UNKNOWN',{ambiguous:true,status:r.status});}
     if(r.status>=200&&r.status<300&&idRe.test(out?.id??''))return {outcome:'accepted',providerTaskId:out.id};
     throw new SeedanceProviderError('SUBMISSION_UNKNOWN',{ambiguous:true,status:r.status});
   },
   async getStatus(taskId){guard();if(!idRe.test(taskId??''))throw new SeedanceProviderError('INVALID_TASK_ID');
     let r;try{r=await fetchImpl(`${SEEDANCE_FIXED_ENDPOINT}/${encodeURIComponent(taskId)}`,{method:'GET',headers:headers(),redirect:'manual',signal:AbortSignal.timeout(timeoutMs)});}catch{throw new SeedanceProviderError('STATUS_UNAVAILABLE');}
     if(!r.ok)throw new SeedanceProviderError('STATUS_UNAVAILABLE',{status:r.status});const data=await json(r);
     const state=data.status??data.state;if(!['queued','running','succeeded','failed','expired'].includes(state))throw new SeedanceProviderError('UNKNOWN_PROVIDER_STATUS');
     return {state,providerTaskId:taskId,outputReady:state==='succeeded',rawUsageAvailable:!!data.usage,taskMetadata:data};
   }
 });
}
