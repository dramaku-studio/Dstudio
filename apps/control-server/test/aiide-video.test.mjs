import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {createEncryptedKeyPools} from '../../../packages/security/src/key-pools.mjs';
import {createAiideVideoEngine,approvedAiideResultUrl} from '../aiide-video.mjs';
const input={model:'doubao-seedance-2-0-fast-260128',mode:'text_to_video',prompt:'A smooth aerial orbit around a lighthouse in fog',duration:5,resolution:'provider_default',ratio:'9:16',assets:[]};
const make=async({enabled=true,capabilityVerified=true,fetchImpl=async()=>{throw Error('network must not run')},hosts=[]}={})=>{
 const root=await mkdtemp(join(tmpdir(),'ds-aiide-test-'));
 const keys=createEncryptedKeyPools({file:join(root,'pool.enc.json'),key:randomBytes(32).toString('base64')});
 await keys.add({group:'video',provider:'aiide',label:'AIIDE test',secret:'aiide-local-fake-key-for-test'});
 const makeEngine=()=>createAiideVideoEngine({root:join(root,'jobs'),keyPool:keys,enabled,capabilityVerified,fetchImpl,allowedMediaHosts:hosts});
 const engine=makeEngine();await engine.init();return {root,engine,makeEngine,keys,close:()=>rm(root,{recursive:true,force:true})};
};
test('AIIDE refuses paid submit when disabled or unverified',async()=>{
 for(const config of [{enabled:false,capabilityVerified:true},{enabled:true,capabilityVerified:false}]){
  const t=await make(config);try{await assert.rejects(t.engine.submit({input,consent:'I_ACCEPT_PROVIDER_CHARGES'}));}finally{await t.close();}
 }
});
test('uses saved AIIDE key, persists same key id, polls by GET and blocks duplicate job',async()=>{
 let count=0;const fetchImpl=async(url,opts)=>{count++;if(opts.method==='POST')return Response.json({task_id:'cgt-20261106000100-xyzz'});return Response.json({data:{status:'QUEUED'}});};
 const t=await make({fetchImpl});try{
  const created=await t.engine.submit({input,consent:'I_ACCEPT_PROVIDER_CHARGES'});assert.equal(created.status,'submitted');assert.equal(count,1);
  assert.equal((await t.engine.check(created.id)).status,'queued');assert.equal(count,2);
  await assert.rejects(t.engine.submit({input,consent:'I_ACCEPT_PROVIDER_CHARGES'}),{code:'AIIDE_ONE_JOB_PER_DAY'});
  const restarted=t.makeEngine();await restarted.init();assert.equal((await restarted.list()).jobs[0].providerTaskId,'cgt-20261106000100-xyzz');
  assert.equal((await restarted.check(created.id)).status,'queued');assert.equal(count,3);
  const saved=JSON.parse(await readFile(join(t.root,'jobs','aiide-video-jobs.json')));assert.equal(saved.jobs[0].providerTaskId,'cgt-20261106000100-xyzz');
  assert.ok(!JSON.stringify(saved).includes('aiide-local-fake-key'));
 }finally{await t.close();}
});
test('uncertain submit leaves a durable, non-retryable task',async()=>{
 let hits=0;const t=await make({fetchImpl:async()=>{hits++;throw Error('network lost after provider accepted')}});
 try{const j=await t.engine.submit({input,consent:'I_ACCEPT_PROVIDER_CHARGES'});assert.equal(j.status,'submission_unknown');assert.equal(hits,1);await assert.rejects(t.engine.check(j.id),{code:'AIIDE_MANUAL_RECONCILIATION_REQUIRED'});assert.equal(hits,1);}finally{await t.close();}
});
test('never download URLs without an explicitly approved HTTPS host',()=>{
 assert.equal(approvedAiideResultUrl('https://cdn.example.com/video.mp4?sig=x',['cdn.example.com']).hostname,'cdn.example.com');
 for(const u of ['http://cdn.example.com/x.mp4','https://127.0.0.1/x.mp4','https://localhost/x.mp4','https://cdn.example.com.attacker.net/x.mp4'])assert.throws(()=>approvedAiideResultUrl(u,['cdn.example.com']));
});
