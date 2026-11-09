import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLocalTtsEngine,compileSpeechInput} from '../tts-engine.mjs';

const sample={provider:'openai',voice:'coral',language:'id',speed:1,text:'Selamat datang di Dramasaku Studio.'};
const mp3=Buffer.concat([Buffer.from('ID3'),Buffer.alloc(256,0x19)]);
const harness=async (options={})=>{
 const root=await mkdtemp(join(tmpdir(),'ds-tts-'));
 let sent=0,auth=null,endpoint=null;
 const fetchImpl=async(url,opts)=>{sent++;endpoint=url;auth=opts.headers.authorization;return options.response??new Response(mp3,{status:200,headers:{'content-type':'audio/mpeg'}});};
 const engine=createLocalTtsEngine({root,loadApiKey:async slot=>slot==='voice'?'test-voice-key-private-8888':'test-aiide-voice-key',fetchImpl, ...options});await engine.init();
 return {engine,root,getSent:()=>sent,getAuth:()=>auth,getEndpoint:()=>endpoint,close:()=>rm(root,{force:true,recursive:true})};
};
test('speech planner validates text/voice/provider/speed and never returns secret',()=>{
 assert.equal(compileSpeechInput(sample).payload.model,'gpt-4o-mini-tts');
 for(const change of [{voice:'hacker'},{provider:'unknown'},{speed:50},{text:''},{text:'x'.repeat(3001)}])assert.throws(()=>compileSpeechInput({...sample,...change}));
 assert.ok(!JSON.stringify(compileSpeechInput(sample)).includes('test-voice-key'));
});
test('TTS disabled by default; cannot accidentally call paid endpoint',async()=>{
 const h=await harness();try{
  await assert.rejects(h.engine.generate({input:sample,consent:'I_ACCEPT_PROVIDER_CHARGES'}),e=>e.code==='TTS_LIVE_DISABLED');
  assert.equal(h.getSent(),0);
  assert.equal((await h.engine.draft(sample)).status,'draft');
 }finally{await h.close();}
});
test('TTS requires capability verification, never treats AIIDE chat support as voice entitlement',async()=>{
 const h=await harness({enabled:true,capabilityVerified:true,aiideCapabilityVerified:false});try{
  await assert.rejects(h.engine.generate({input:{...sample,provider:'aiide'},consent:'I_ACCEPT_PROVIDER_CHARGES'}),e=>e.code==='TTS_PROVIDER_CAPABILITY_UNVERIFIED');
  await assert.rejects(h.engine.generate({input:sample,consent:'NO'}),e=>e.code==='PAID_CONSENT_REQUIRED');
  assert.equal(h.getSent(),0);
 }finally{await h.close();}
});
test('success stores private MP3 with SHA, no secret in metadata; duplicate paid request blocked',async()=>{
 const h=await harness({enabled:true,capabilityVerified:true});try{
  const job=await h.engine.generate({input:sample,consent:'I_ACCEPT_PROVIDER_CHARGES'});
  assert.equal(job.status,'ready');assert.equal(h.getSent(),1);
  assert.equal(h.getAuth(),'Bearer test-voice-key-private-8888');
  assert.equal(h.getEndpoint(),'https://api.openai.com/v1/audio/speech');
  const audio=await h.engine.audio(job.id);assert.deepEqual(audio.bytes,mp3);
  assert.ok(!JSON.stringify(await h.engine.list()).includes('test-voice-key-private'));
  const storage=await readFile(join(h.root,'tts-index.json'),'utf8');assert.ok(!storage.includes('test-voice-key-private'));
  await assert.rejects(h.engine.generate({input:sample,consent:'I_ACCEPT_PROVIDER_CHARGES'}),e=>['TTS_DUPLICATE_SAME_DAY','TTS_DAILY_LIMIT'].includes(e.code));
  assert.equal(h.getSent(),1);
 }finally{await h.close();}
});
test('wrong MIME blocks audio while remaining unknown rather than blind paid retry',async()=>{
 const h=await harness({enabled:true,capabilityVerified:true,response:new Response('<html>oops</html>',{status:200,headers:{'content-type':'text/html'}})});try{
  const job=await h.engine.generate({input:sample,consent:'I_ACCEPT_PROVIDER_CHARGES'});
  assert.equal(job.status,'submission_unknown');assert.equal(job.errorCode,'TTS_UNEXPECTED_CONTENT_TYPE');
  await assert.rejects(h.engine.audio(job.id),e=>e.code==='TTS_AUDIO_NOT_READY');
  assert.equal(h.getSent(),1);
 }finally{await h.close();}
});
test('TTS media SHA mismatch is rejected even when file length matches',async()=>{
 const h=await harness({enabled:true,capabilityVerified:true});try{
  const job=await h.engine.generate({input:sample,consent:'I_ACCEPT_PROVIDER_CHARGES'});
  const {writeFile}=await import('node:fs/promises');await writeFile(join(h.root,`${job.id}.mp3`),Buffer.alloc(mp3.length,0x31));
  await assert.rejects(h.engine.audio(job.id),e=>e.code==='TTS_MEDIA_INTEGRITY_FAILURE');
 }finally{await h.close();}
});
