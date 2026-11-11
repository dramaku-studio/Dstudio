import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createEncryptedKeyPools} from '../../../packages/security/src/key-pools.mjs';
import {createAiideActivation} from '../aiide-activation.mjs';
import {createAiideVideoEngine} from '../aiide-video.mjs';
const model='doubao-seedance-2-0-fast-260128';
const input={model,mode:'text_to_video',prompt:'A smooth aerial orbit around a lighthouse in fog',duration:5,resolution:'provider_default',ratio:'9:16',assets:[]};
async function setup(t){
 const root=await mkdtemp(join(tmpdir(),'cp021-mock-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const keys=createEncryptedKeyPools({file:join(root,'keys.enc'),key:randomBytes(32).toString('base64')});
 let state=200,models=[model],gets=0,posts=0;
 const activation=createAiideActivation({keyPools:keys,fetchImpl:async(url,opts)=>{gets++;assert.equal(opts.method,'GET');assert.equal(url,'https://www.aiide.com/v1/models');if(state===0)throw Error('mock timeout');return Response.json({data:models.map(id=>({id}))},{status:state});}});
 const engine=createAiideVideoEngine({root:join(root,'jobs'),keyPool:keys,activation,fetchImpl:async(url,opts)=>{assert.equal(opts.method,'POST');posts++;return Response.json({task_id:'cgt-20261106000100-xyzz'});}});await engine.init();
 const add=()=>keys.add({group:'video',provider:'aiide',label:'Mock only',secret:'cp021-disposable-mock-secret'});
 return {keys,activation,engine,add,setState:n=>state=n,setModels:n=>models=n,counts:()=>({gets,posts})};
}
test('auto activation is GET only, caches readiness, disables with key, rechecks after restart',async t=>{
 const x=await setup(t);assert.equal((await x.engine.list()).enabled,false);assert.deepEqual(x.counts(),{gets:0,posts:0});
 const key=await x.add();assert.equal((await x.activation.status({cachedOnly:true})).ready,false);assert.equal(x.counts().gets,0);
 assert.equal((await x.activation.check(key.id)).state,'connected');assert.equal((await x.engine.list()).enabled,true);assert.equal((await x.engine.list()).capabilityVerified,false);assert.deepEqual(x.counts(),{gets:1,posts:0});
 await x.keys.update({id:key.id,enabled:false});assert.equal((await x.engine.list()).enabled,false);
 await assert.rejects(x.engine.submit({input,consent:'I_ACCEPT_PROVIDER_CHARGES'}),{code:'AIIDE_NO_ACTIVE_KEY'});
 await x.keys.update({id:key.id,enabled:true});
 let reads=0;const restarted=createAiideActivation({keyPools:x.keys,fetchImpl:async()=>{reads++;return Response.json({}, {status:401});}});
 assert.equal((await restarted.status()).ready,false);assert.equal(reads,1);assert.equal(x.counts().posts,0);
});
test('invalid, limited, unavailable and unsupported catalogs cannot enable or submit',async t=>{
 const x=await setup(t);const key=await x.add();
 for(const status of [401,403,429,0]){x.setState(status);await x.activation.check(key.id,{fresh:true});assert.equal((await x.engine.list()).enabled,false);await assert.rejects(x.engine.submit({input,consent:'I_ACCEPT_PROVIDER_CHARGES'}),{code:'AIIDE_KEY_NOT_VERIFIED'});}
 x.setState(200);x.setModels(['unrelated-model']);await x.activation.check(key.id,{fresh:true});assert.equal((await x.engine.list()).enabled,false);assert.equal((await x.engine.list()).activationState,'catalog_not_supported');
 await assert.rejects(x.engine.submit({input,consent:'I_ACCEPT_PROVIDER_CHARGES'}),{code:'AIIDE_MODEL_NOT_AVAILABLE'});assert.equal(x.counts().posts,0);
 assert.equal((await x.keys.preview('video','aiide')).selected.usedToday,0);
});
test('cached valid key cannot bypass fresh validation; consent and parallel submission guards hold',async t=>{
 const x=await setup(t);await x.add();assert.equal((await x.engine.list()).enabled,true);
 await assert.rejects(x.engine.submit({input}),{code:'AIIDE_COST_CONSENT_REQUIRED'});assert.equal(x.counts().posts,0);
 x.setState(401);await assert.rejects(x.engine.submit({input,consent:'I_ACCEPT_PROVIDER_CHARGES'}),{code:'AIIDE_KEY_NOT_VERIFIED'});assert.equal(x.counts().posts,0);
 x.setState(200);const results=await Promise.allSettled([1,2].map(()=>x.engine.submit({input,consent:'I_ACCEPT_PROVIDER_CHARGES'})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='fulfilled').value.status,'submitted');assert.equal(x.counts().posts,1);
});

test('current AIIDE Model Plaza IDs activate only documented video models',async t=>{const x=await setup(t);await x.add();const models=['dreamina-seedance-2-0-fast-hc','dreamina-seedance-2-0-hc','dreamina-seedance-2-0-mini-hc','dreamina-seedance-2-5-hc','doubao-seedance-2-0-mini-260615','doubao-seedance-2-5-260628'];x.setModels([...models,'gpt-image-2','unknown-future-video']);const status=await x.engine.list();assert.equal(status.enabled,true);assert.deepEqual(status.availableModels,models);assert.deepEqual(x.counts(),{gets:1,posts:0});});

test('AIIDE provider quota is opt-in per key and allows separate confirmed requests',async t=>{
 const x=await setup(t),key=await x.add();
 const submit=(prompt)=>x.engine.submit({input:{...input,prompt},consent:'I_ACCEPT_PROVIDER_CHARGES'});
 await submit(input.prompt);
 assert.equal((await x.engine.list()).maxDaily,1);
 const changed=await x.keys.update({id:key.id,dailyLimit:null});
 assert.equal(changed.remaining,null);
 assert.equal((await x.engine.list()).maxDaily,null);
 await assert.rejects(submit(input.prompt),{code:'AIIDE_DUPLICATE_JOB'});
 await assert.rejects(x.engine.submit({input}),{code:'AIIDE_COST_CONSENT_REQUIRED'});
 await submit(input.prompt+' Pan slowly to the left.');
 assert.equal(x.counts().posts,2);
 assert.equal((await x.engine.list()).usedToday,2);
 await x.keys.update({id:key.id,dailyLimit:100});
 await assert.rejects(submit(input.prompt+' A third camera angle.'),{code:'AIIDE_ONE_JOB_PER_DAY'});
});
