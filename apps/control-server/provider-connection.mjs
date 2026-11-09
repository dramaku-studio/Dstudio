/** Read-only credential verification. No generation endpoints, reservations or paid flags. */
import {AIIDE_MODELS} from '../../packages/providers/src/aiide-video-plan.mjs';
const endpoint='https://www.aiide.com/v1/models';
const fail=(code,status=422)=>Object.assign(new Error(code),{code,status});
async function boundedJson(response){
 if(!(response.headers.get('content-type')||'').toLowerCase().startsWith('application/json')||!response.body)throw fail('KEY_CHECK_INVALID_RESPONSE',502);
 const limit=1024*1024;
 if(Number(response.headers.get('content-length'))>limit)throw fail('KEY_CHECK_RESPONSE_TOO_LARGE',502);
 const reader=response.body.getReader();const parts=[];let total=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>limit){await reader.cancel().catch(()=>{});throw fail('KEY_CHECK_RESPONSE_TOO_LARGE',502);}parts.push(Buffer.from(value));}}
 finally{reader.releaseLock();}
 try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw fail('KEY_CHECK_INVALID_RESPONSE',502);}
}
export function createProviderConnectionTester({keyPools,fetchImpl=fetch,cooldownMs=30000,clock=Date.now}={}){
 const active=new Set(),last=new Map();
 return Object.freeze({async test({keyId}={}){
  if(typeof keyId!=='string'||!/^[a-f0-9]{24}$/.test(keyId))throw fail('INVALID_KEY_ID');
  const snapshot=await keyPools.list();const key=snapshot.pools.flatMap(p=>p.keys).find(k=>k.id===keyId);
  if(!key)throw fail('KEY_NOT_FOUND',404);
  if(!key.enabled)throw fail('KEY_DISABLED',409);
  if(key.provider!=='aiide')throw fail('KEY_CHECK_PROVIDER_UNSUPPORTED',422);
  const now=clock();if(active.has(keyId)||(last.has(keyId)&&now-last.get(keyId)<cooldownMs))throw fail('KEY_CHECK_COOLDOWN',429);
  active.add(keyId);last.set(keyId,now);
  try{
   const secret=await keyPools.getForInternalTask(keyId,key.group,'aiide');
   let response;try{response=await fetchImpl(endpoint,{method:'GET',headers:{authorization:`Bearer ${secret}`,accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(15000)});}catch{throw fail('KEY_CHECK_UNAVAILABLE',503);}
   const base={provider:'aiide',keyId,checkedAt:new Date().toISOString(),method:'GET',generationCalls:0,enablesPaidGeneration:false,videoContractTested:false};
   if([401,403].includes(response.status))return {...base,state:'rejected',catalogReadable:false};
   if(response.status===429)return {...base,state:'rate_limited',catalogReadable:false};
   if(response.status!==200)throw fail(response.status>=300&&response.status<400?'KEY_CHECK_REDIRECT_REFUSED':'KEY_CHECK_UNAVAILABLE',502);
   const data=await boundedJson(response);
   if(!Array.isArray(data?.data)||data.data.length>10000||data.data.some(m=>!m||typeof m.id!=='string'))throw fail('KEY_CHECK_INVALID_RESPONSE',502);
   const ids=new Set(data.data.map(m=>m.id));
   return {...base,state:'connected',catalogReadable:true,modelCount:ids.size,matchingVideoModels:AIIDE_MODELS.filter(m=>ids.has(m.id)).map(m=>m.id)};
  }finally{active.delete(keyId);}
 }});
}
