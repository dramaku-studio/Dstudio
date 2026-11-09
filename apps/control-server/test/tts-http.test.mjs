import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createLocalConsole} from '../server.mjs';
const mp3=Buffer.concat([Buffer.from('ID3'),Buffer.alloc(256,0x18)]);
const sample={provider:'openai',voice:'coral',language:'id',speed:1,text:'Halo dari Dramasaku Studio.'};
const harness=async(opts={})=>{
 const root=await mkdtemp(join(tmpdir(),'ds-tts-http-'));
 let calls=0;
 const app=createLocalConsole({port:41000+Math.floor(Math.random()*10000),adminToken:'local-test-operator-token-1234567890',vaultKey:randomBytes(32).toString('base64'),vaultFile:join(root,'credentials.enc.json'),ttsEnabled:true,ttsCapabilityVerified:true,ttsFetchImpl:async()=>{calls++;return new Response(mp3,{status:200,headers:{'content-type':'audio/mpeg'}})},...opts});
 await app.listen();const base=`http://127.0.0.1:${app.server.address().port}`;
 let cookie='',csrf='';
 const call=async(path,method='GET',body)=>{
  const response=await fetch(base+path,{method,headers:{...(cookie?{cookie}:{}),...(method==='GET'?{}:{origin:base,'content-type':'application/json','x-dramasaku-csrf':csrf})},body:method==='GET'?undefined:JSON.stringify(body??{})});
  const setCookie=response.headers.get('set-cookie');if(setCookie?.startsWith('ds_session='))cookie=setCookie.split(';')[0];
  const data=response.headers.get('content-type')?.startsWith('application/json')?await response.json():Buffer.from(await response.arrayBuffer());if(data?.csrf)csrf=data.csrf;
  return {status:response.status,data};
 };
 return {root,app,call,getCalls:()=>calls,close:async()=>{await new Promise(r=>app.server.close(r));await rm(root,{recursive:true,force:true});}};
};
test('TTS HTTP enforces login and CSRF; paid test generates MP3 and attaches to video library',async()=>{
 const h=await harness();try{
  assert.equal((await h.call('/api/tts/status')).status,401);
  const forged=await fetch(`http://127.0.0.1:${h.app.server.address().port}/api/tts/generate`,{method:'POST',headers:{origin:'https://evil.example','content-type':'application/json'},body:JSON.stringify({input:sample,consent:'I_ACCEPT_PROVIDER_CHARGES'})});
  assert.equal(forged.status,403);
  assert.equal((await h.call('/api/login','POST',{token:'local-test-operator-token-1234567890'})).status,200);
  assert.equal((await h.call('/api/tts/status')).data.providers.find(p=>p.id==='openai').configured,false);
  assert.equal((await h.call('/api/keys','POST',{slot:'voice',secret:'long-test-api-key-1234567890'})).status,200);
  assert.equal((await h.call('/api/tts/preview','POST',sample)).data.charge,false);
  const before=await h.call('/api/tts/draft','POST',sample);assert.equal(before.status,201);
  const actual=await h.call('/api/tts/generate','POST',{input:sample,consent:'I_ACCEPT_PROVIDER_CHARGES'});
  assert.equal(actual.status,201);assert.equal(actual.data.job.status,'ready');assert.equal(h.getCalls(),1);
  const audio=await h.call(`/api/tts/jobs/${actual.data.job.id}/audio`);assert.equal(audio.status,200);assert.deepEqual(audio.data,mp3);
  const attach=await h.call(`/api/tts/jobs/${actual.data.job.id}/attach`,'POST',{});assert.equal(attach.status,201);assert.equal(attach.data.asset.kind,'audio');
  assert.equal((await h.call('/api/seedance/assets')).data.assets[0].id,attach.data.asset.id);
 }finally{await h.close();}
});
test('TTS AIIDE cannot dispatch without verified entitlement even if key is saved',async()=>{
 const h=await harness();try{
  await h.call('/api/login','POST',{token:'local-test-operator-token-1234567890'});
  await h.call('/api/keys','POST',{slot:'voice_aiide',secret:'test-aiide-tts-secret-1234567890'});
  const response=await h.call('/api/tts/generate','POST',{input:{...sample,provider:'aiide'},consent:'I_ACCEPT_PROVIDER_CHARGES'});
  assert.equal(response.status,403);assert.equal(response.data.error,'TTS_PROVIDER_CAPABILITY_UNVERIFIED');assert.equal(h.getCalls(),0);
 }finally{await h.close();}
});
