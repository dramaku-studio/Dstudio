/**
 * CP-003 provider-neutral bridge contract (NOT a direct vendor integration).
 * A trusted bridge must implement /v1/video/tasks and /v1/video/tasks/{id}/file.
 * All paths are fixed to the configured origin; no caller-supplied media URLs.
 */
import {DomainError} from '../../domain/src/index.mjs';

const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const MAX_JSON_BYTES = 64 * 1024;

export class ProviderTransportError extends Error {
  constructor(message, {ambiguous=false, definitelyRejected=false, status=null}={}) {
    super(message); this.name='ProviderTransportError';
    this.ambiguous=ambiguous; this.definitelyRejected=definitelyRejected; this.status=status;
  }
}
const checkedId = (id, label) => {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new DomainError('INVALID_REQUEST',`${label} must be a safe identifier`);
  return id;
};
function normalizeBase(baseUrl, allowInsecureLoopback) {
  const url=new URL(baseUrl);
  const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Bridge base URL must contain origin only');
  if (url.protocol !== 'https:' && !(allowInsecureLoopback && local && url.protocol==='http:')) throw new Error('HTTPS bridge origin required');
  if (['0.0.0.0','[::]'].includes(url.hostname)) throw new Error('Wildcard bridge host forbidden');
  return url.origin;
}
async function boundedJson(response) {
  const contentType=response.headers.get('content-type')?.split(';')[0].toLowerCase();
  if (contentType !== 'application/json') throw new ProviderTransportError('Invalid bridge JSON content type', {status:response.status});
  const reader=response.body?.getReader();
  if (!reader) throw new ProviderTransportError('Empty bridge response',{status:response.status});
  const parts=[];let total=0;
  try{
    for (;;) {
      const {done,value}=await reader.read();if(done)break;
      total+=value.byteLength;
      if(total>MAX_JSON_BYTES) throw new ProviderTransportError('Oversized bridge JSON',{status:response.status});
      parts.push(value);
    }
  } finally {reader.releaseLock();}
  try {return JSON.parse(Buffer.concat(parts).toString('utf8'));}
  catch {throw new ProviderTransportError('Invalid bridge JSON',{status:response.status});}
}
export function createHttpVideoBridge({baseUrl,token,allowInsecureLoopback=false,fetchImpl=fetch,timeoutMs=20_000}={}) {
  if(typeof token!=='string' || token.length<16) throw new Error('Bridge token required (at least 16 characters)');
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>120_000)throw new Error('Invalid bridge timeout');
  const origin=normalizeBase(baseUrl, allowInsecureLoopback);
  const request=async(method,path,{json,clientReference,accept='application/json'}={})=>{
    const headers={authorization:`Bearer ${token}`,accept};
    if(json!==undefined)headers['content-type']='application/json';
    if(clientReference)headers['idempotency-key']=checkedId(clientReference,'clientReference');
    return fetchImpl(origin+path,{method,headers,body:json===undefined?undefined:JSON.stringify(json),redirect:'manual',signal:AbortSignal.timeout(timeoutMs)});
  };
  return Object.freeze({
    providerType:'http-bridge',
    validate(input){return typeof input?.prompt==='string' && input.prompt.trim().length>0 && input.prompt.length<=4000;},
    async submit(input,{clientReference}={}) {
      if(!this.validate(input)) throw new DomainError('INVALID_PROMPT','Prompt required, max 4000 characters');
      checkedId(clientReference,'clientReference');
      let response;
      try { response=await request('POST','/v1/video/tasks',{json:{prompt:input.prompt,model:input.model??null},clientReference}); }
      catch {throw new ProviderTransportError('POST outcome unknown; reconcile by client reference', {ambiguous:true});}
      let data;
      try {data=await boundedJson(response);} catch {throw new ProviderTransportError('POST response ambiguous; do not resubmit',{ambiguous:true,status:response.status});}
      if(response.status===400 || response.status===422) {
        if(data?.definitely_not_accepted===true) return {outcome:'rejected',definitelyNotAccepted:true,code:String(data.code??'REJECTED')};
      }
      if(response.status<200 || response.status>=300 || data?.outcome!=='accepted' || !ID_RE.test(data?.task_id??'')) {
        throw new ProviderTransportError('POST outcome ambiguous; manual or key-based reconciliation required',{ambiguous:true,status:response.status});
      }
      return {outcome:'accepted',externalTaskId:data.task_id};
    },
    async getStatus(externalTaskId) {
      const id=checkedId(externalTaskId,'externalTaskId');
      let response;
      try {response=await request('GET',`/v1/video/tasks/${id}`);}catch{throw new ProviderTransportError('Status request failed');}
      if(!response.ok)throw new ProviderTransportError('Provider status request failed',{status:response.status});
      const data=await boundedJson(response);
      if(!['queued','processing','succeeded','failed','canceled'].includes(data?.state)) throw new ProviderTransportError('Unknown provider status');
      if(data.state==='succeeded' && (!Number.isSafeInteger(data.actual_minor)||data.actual_minor<0)) {
        throw new ProviderTransportError('Succeeded but billing amount absent: reconciliation required');
      }
      return {state:data.state, ...(data.state==='succeeded'?{actualMinor:data.actual_minor}:{})};
    },
    async openVideo(externalTaskId) {
      const id=checkedId(externalTaskId,'externalTaskId');
      let response;
      try {response=await request('GET',`/v1/video/tasks/${id}/file`,{accept:'video/mp4'});}
      catch {throw new ProviderTransportError('Video retrieval failed');}
      if(!response.ok || response.status!==200) throw new ProviderTransportError('Video retrieval refused',{status:response.status});
      if(response.headers.get('content-type')?.split(';')[0].toLowerCase()!=='video/mp4') throw new ProviderTransportError('Unexpected video MIME type');
      const stated=Number(response.headers.get('content-length'));
      if(response.headers.has('content-length') && (!Number.isSafeInteger(stated)||stated<1))throw new ProviderTransportError('Invalid video length');
      if(!response.body)throw new ProviderTransportError('Empty video response');
      return {stream:response.body,length:response.headers.has('content-length')?stated:null,contentType:'video/mp4'};
    }
  });
}
