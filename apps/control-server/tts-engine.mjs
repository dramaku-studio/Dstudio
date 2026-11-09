/** Local TTS pilot. Paid POST strictly opt-in; no automatic retries or provider bypass.
 * In particular, an AIIDE chat-compatible key does NOT prove its TTS endpoint is enabled.
 */
import {mkdir,readFile,writeFile,rename,open,stat,lstat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';

const PROVIDERS={
 openai:{endpoint:'https://api.openai.com/v1/audio/speech',slot:'voice',model:'gpt-4o-mini-tts'},
 aiide:{endpoint:'https://aiide.com/v1/audio/speech',slot:'voice_aiide',model:'gpt-4o-mini-tts'}
};
const VOICES=['alloy','ash','ballad','coral','echo','fable','onyx','nova','sage','shimmer','verse'];
const ID=/^[a-f0-9]{24}$/;
const SHA=/^[a-f0-9]{64}$/;
const fail=(code,status=422)=>Object.assign(new Error(code),{code,status});
const utcDay=()=>new Date().toISOString().slice(0,10);
export function compileSpeechInput(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw fail('BAD_TTS_INPUT');
 const provider=input.provider??'openai';if(!PROVIDERS[provider])throw fail('TTS_PROVIDER_UNSUPPORTED');
 const voice=input.voice??'coral';if(!VOICES.includes(voice))throw fail('TTS_VOICE_UNSUPPORTED');
 const language=input.language??'id';if(!['id','en'].includes(language))throw fail('TTS_LANGUAGE_UNSUPPORTED');
 const speed=input.speed??1;if(typeof speed!=='number'||!Number.isFinite(speed)||speed<0.5||speed>2)throw fail('TTS_SPEED_UNSUPPORTED');
 const text=input.text;if(typeof text!=='string'||!text.trim()||text.length>3000||/[\u0000-\u0008\u000b\u000e-\u001f]/.test(text))throw fail('TTS_TEXT_INVALID');
 const clean=text.trim();const model=PROVIDERS[provider].model;
 const body={model,voice,input:clean,response_format:'mp3',speed};
 // Language is a UI hint, not a guaranteed supported Speech API request parameter.
 const hash=createHash('sha256').update(JSON.stringify({provider,model,voice,language,speed,text:clean})).digest('hex');
 return {provider,voice,language,speed,model,requestHash:hash,characters:clean.length,payload:body};
}

async function readMp3Response(response,maxBytes=12*1024*1024){
 if(response.status!==200||!response.body)throw fail('TTS_PROVIDER_RESPONSE_UNCERTAIN',502);
 const mime=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
 if(!['audio/mpeg','audio/mp3','application/octet-stream'].includes(mime))throw fail('TTS_UNEXPECTED_CONTENT_TYPE',502);
 const length=response.headers.get('content-length');if(length && Number(length)>maxBytes)throw fail('TTS_AUDIO_TOO_LARGE',502);
 const reader=response.body.getReader();let total=0;const parts=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>maxBytes)throw fail('TTS_AUDIO_TOO_LARGE',502);parts.push(Buffer.from(value));}}
 finally{reader.releaseLock();}
 const audio=Buffer.concat(parts,total);
 if(audio.length<64||!(audio.toString('ascii',0,3)==='ID3'||(audio[0]===0xff&&(audio[1]&0xe0)===0xe0)))throw fail('TTS_AUDIO_SIGNATURE_INVALID',502);
 return audio;
}

export function createLocalTtsEngine({root,loadApiKey,fetchImpl=fetch,enabled=false,capabilityVerified=false,aiideCapabilityVerified=false,maxDaily=1,clock=utcDay}={}){
 if(typeof root!=='string'||!root.trim()||typeof loadApiKey!=='function'||typeof fetchImpl!=='function')throw fail('TTS_CONFIG_INVALID');
 if(!Number.isInteger(maxDaily)||maxDaily<1||maxDaily>5)throw fail('TTS_DAILY_CAP_INVALID');
 const folder=resolve(root),index=join(folder,'tts-index.json');let entries=[],loaded=false,chain=Promise.resolve();
 const serial=f=>{const promise=chain.then(f);chain=promise.catch(()=>{});return promise;};
 const publicJob=j=>({id:j.id,projectId:j.projectId||null,provider:j.provider,model:j.model,voice:j.voice,language:j.language,speed:j.speed,characters:j.characters,status:j.status,draftAvailable:j.status==='draft'&&j.hasDraftText===true,createdAt:j.createdAt,updatedAt:j.updatedAt,bytes:j.bytes||null,sha256:j.sha256||null,errorCode:j.errorCode||null});
 const save=async()=>{const temp=join(folder,`.tts-${randomBytes(6).toString('hex')}.tmp`);await writeFile(temp,JSON.stringify({version:1,entries}),{flag:'wx',mode:0o600});await rename(temp,index);};
 const ready=()=>{if(!loaded)throw fail('TTS_NOT_INITIALIZED',503);};
 const get=id=>{if(!ID.test(String(id)))throw fail('TTS_JOB_NOT_FOUND',404);const j=entries.find(x=>x.id===id);if(!j)throw fail('TTS_JOB_NOT_FOUND',404);return j;};
 const activeProvider=provider=>provider==='openai'?capabilityVerified===true:aiideCapabilityVerified===true;
 const liveAvailable=provider=>enabled===true&&activeProvider(provider);
 async function keyConfigured(provider){return !!(await loadApiKey(PROVIDERS[provider].slot));}
 return Object.freeze({
  async init(){await mkdir(folder,{recursive:true,mode:0o700});try{const s=await lstat(index);if(!s.isFile()||s.isSymbolicLink()||s.size>1_000_000)throw fail('TTS_INDEX_INVALID');const data=JSON.parse(await readFile(index,'utf8'));if(data.version!==1||!Array.isArray(data.entries)||data.entries.length>1000||data.entries.some(x=>!ID.test(x.id)||!['draft','submission_unknown','ready'].includes(x.status)))throw fail('TTS_INDEX_INVALID');entries=data.entries;}catch(e){if(e.code!=='ENOENT')throw e;await save();}loaded=true;},
  preview(input){ready();const plan=compileSpeechInput(input);return {provider:plan.provider,model:plan.model,voice:plan.voice,language:plan.language,speed:plan.speed,characters:plan.characters,requestHash:plan.requestHash,charge:false};},
  async list(){ready();const day=clock();return {enabled,providers:await Promise.all(Object.keys(PROVIDERS).map(async p=>({id:p,configured:await keyConfigured(p),verified:activeProvider(p),liveAvailable:liveAvailable(p)}))),maxDaily,usedToday:entries.filter(j=>j.status!=='draft'&&j.createdAt.slice(0,10)===day).length,quotaType:'local_limit_not_provider_balance',autoRetry:false,jobs:entries.slice(-30).reverse().map(publicJob)};},
  async draft(input,{projectId=null}={}){ready();const plan=compileSpeechInput(input);return serial(async()=>{
   if(entries.length>=1000)throw fail('TTS_HISTORY_FULL',409);
   const now=new Date().toISOString();const job={id:randomBytes(12).toString('hex'),provider:plan.provider,model:plan.model,voice:plan.voice,language:plan.language,speed:plan.speed,characters:plan.characters,requestHash:plan.requestHash,status:'draft',projectId,hasDraftText:true,createdAt:now,updatedAt:now};
   // Keep narration in its own private file so long drafts cannot overflow the history index.
   const draftInput={provider:plan.provider,voice:plan.voice,language:plan.language,speed:plan.speed,text:plan.payload.input};
   const handle=await open(join(folder,`${job.id}.draft.json`),'wx',0o600);
   try{await handle.writeFile(JSON.stringify({version:1,input:draftInput}));await handle.sync();}finally{await handle.close();}
   entries.push(job);await save();return publicJob(job);
  });},
  async readDraft(id){ready();const j=get(id);
   if(j.status!=='draft'||j.hasDraftText!==true)throw fail('TTS_DRAFT_TEXT_UNAVAILABLE',409);
   const path=join(folder,`${j.id}.draft.json`);const s=await lstat(path);
   if(!s.isFile()||s.isSymbolicLink()||s.size>16000)throw fail('TTS_DRAFT_INVALID',409);
   const data=JSON.parse(await readFile(path,'utf8'));
   if(data.version!==1)throw fail('TTS_DRAFT_INVALID',409);
   const plan=compileSpeechInput(data.input);
   if(plan.requestHash!==j.requestHash)throw fail('TTS_DRAFT_INVALID',409);
   return {id:j.id,input:{provider:plan.provider,voice:plan.voice,language:plan.language,speed:plan.speed,text:plan.payload.input},updatedAt:j.updatedAt};
  },
  async exportDrafts(projectId){const out=[];for(const j of entries.filter(x=>x.status==='draft'&&x.hasDraftText&&x.projectId===projectId))out.push((await this.readDraft(j.id)).input);return out;},
  async generate({input,consent}={}){ready();if(!enabled)throw fail('TTS_LIVE_DISABLED',403);if(consent!=='I_ACCEPT_PROVIDER_CHARGES')throw fail('PAID_CONSENT_REQUIRED',403);
   const plan=compileSpeechInput(input);if(!liveAvailable(plan.provider))throw fail('TTS_PROVIDER_CAPABILITY_UNVERIFIED',403);
   return serial(async()=>{
     if(entries.filter(j=>j.status!=='draft'&&j.createdAt.slice(0,10)===clock()).length>=maxDaily)throw fail('TTS_DAILY_LIMIT',429);
     if(entries.some(j=>j.status!=='draft'&&j.requestHash===plan.requestHash&&j.createdAt.slice(0,10)===clock()))throw fail('TTS_DUPLICATE_SAME_DAY',409);
     const secret=await loadApiKey(PROVIDERS[plan.provider].slot);if(typeof secret!=='string'||secret.length<12)throw fail('TTS_KEY_REQUIRED',409);
     const now=new Date().toISOString();const job={id:randomBytes(12).toString('hex'),provider:plan.provider,model:plan.model,voice:plan.voice,language:plan.language,speed:plan.speed,characters:plan.characters,requestHash:plan.requestHash,status:'submission_unknown',createdAt:now,updatedAt:now};
     entries.push(job);await save(); // Persist intent BEFORE paid POST. A crash is never auto-retried.
     try{
      const response=await fetchImpl(PROVIDERS[plan.provider].endpoint,{method:'POST',headers:{authorization:`Bearer ${secret}`,'content-type':'application/json',accept:'audio/mpeg'},body:JSON.stringify(plan.payload),redirect:'manual',signal:AbortSignal.timeout(45_000)});
      const audio=await readMp3Response(response);
      const sha=createHash('sha256').update(audio).digest('hex'),file=join(folder,`${job.id}.mp3`);
      const handle=await open(file,'wx',0o600);try{await handle.writeFile(audio);await handle.sync();}finally{await handle.close();}
      job.status='ready';job.sha256=sha;job.bytes=audio.length;job.errorCode=null;
     }catch(e){job.status='submission_unknown';job.errorCode=e.code||'TTS_SUBMISSION_UNKNOWN';}
     job.updatedAt=new Date().toISOString();await save();return publicJob(job);
   });
  },
  async audio(id){ready();const j=get(id);if(j.status!=='ready'||!SHA.test(j.sha256||''))throw fail('TTS_AUDIO_NOT_READY',404);
   const path=join(folder,`${j.id}.mp3`),s=await lstat(path);if(!s.isFile()||s.isSymbolicLink()||s.size!==j.bytes)throw fail('TTS_MEDIA_INTEGRITY_FAILURE',409);
   const bytes=await readFile(path);if(createHash('sha256').update(bytes).digest('hex')!==j.sha256)throw fail('TTS_MEDIA_INTEGRITY_FAILURE',409);
   return {bytes,stream:createReadStream(path),size:s.size,filename:'dramasaku-narration.mp3'};
  }
 });
}
