import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLocalLiveEngine,approvedMediaURL} from '../local-live.mjs';
const input={model:'doubao-seedance-2-0-260128',mode:'text_to_video',prompt:'Dramasaku: rainy Jakarta city, cinematic camera movement',resolution:'720p',ratio:'9:16',duration:5,assets:[]};
const apiKey='test-only-volcengine-credential';
const videoURL='https://ark-acg-cn-beijing.tos-cn-beijing.volces.com/mock.mp4';
const fixture=new URL('../../../fixtures/fixture-video.mp4',import.meta.url);
const json=(x)=>new Response(JSON.stringify(x),{status:200,headers:{'content-type':'application/json'}});
test('media signed URLs are allowlisted: no SSRF, credentials, redirects or HTTP',()=>{
 assert.equal(approvedMediaURL(videoURL).protocol,'https:');
 for(const u of ['http://127.0.0.1/video.mp4','https://127.0.0.1/video.mp4','https://evil.com/?url=volces.com','https://localhost/private.mp4','https://foo.tos-cn-beijing.volces.com.evil.test/a.mp4','https://user:pass@foo.tos-cn-beijing.volces.com/file.mp4','https://foo.tos-cn-beijing.volces.com:444/a.mp4'])assert.throws(()=>approvedMediaURL(u),e=>e.code==='RESULT_URL_REJECTED');
});
test('local pilot defaults to blocked and does not consume quota or call provider',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ds-live-off-'));let sent=0;
 const e=createLocalLiveEngine({root:dir,loadApiKey:async()=>apiKey,fetchImpl:async()=>{sent++},enabled:false});
 try{await e.init();await assert.rejects(e.submit({input,consent:'I_ACCEPT_PROVIDER_CHARGES'}),x=>x.code==='LIVE_TEST_DISABLED');assert.equal(sent,0);assert.equal((await e.list()).usedToday,0);}finally{await rm(dir,{recursive:true,force:true});}
});
test('confirmed single live submission, safe polling and MP4 storage with no second POST',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ds-live-on-'));let posts=0,gets=0;const video=await readFile(fixture);
 const e=createLocalLiveEngine({root:dir,loadApiKey:async()=>apiKey,enabled:true,capabilityVerified:true,maxDaily:1,fetchImpl:async(url,opt)=>{
  if(opt.method==='POST'){posts++;assert.equal(opt.headers.authorization,'Bearer '+apiKey);return json({id:'lsd_123456789'});}
  if(url===videoURL){gets++;return new Response(video,{headers:{'content-type':'video/mp4','content-length':String(video.length)}});}
  gets++;return json({status:'succeeded',content:{video_url:videoURL},usage:{completion_tokens:23}});
 }});
 try{await e.init();
  await assert.rejects(e.submit({input,consent:'no'}),x=>x.code==='PAID_CONSENT_REQUIRED');assert.equal(posts,0);
  const job=await e.submit({input,consent:'I_ACCEPT_PROVIDER_CHARGES'});assert.equal(job.status,'submitted');assert.equal(posts,1);
  const final=await e.check(job.id);assert.equal(final.status,'ready');assert(final.mediaBytes>1000);assert.equal(gets,2);
  const saved=await e.mediaPath(job.id);assert.equal(saved.size,video.length);saved.stream.destroy();
  await assert.rejects(e.submit({input:{...input,prompt:'different'},consent:'I_ACCEPT_PROVIDER_CHARGES'}),x=>x.code==='DAILY_LOCAL_TEST_LIMIT');assert.equal(posts,1);
  const after=createLocalLiveEngine({root:dir,loadApiKey:async()=>apiKey,enabled:false});await after.init();assert.equal((await after.list()).jobs[0].status,'ready');
  assert(!JSON.stringify(await after.list()).includes('video_url'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('ambiguous paid POST is durable and no automatic retries after restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ds-live-unknown-'));let count=0;
 try{
  const e=createLocalLiveEngine({root:dir,loadApiKey:async()=>apiKey,enabled:true,capabilityVerified:true,fetchImpl:async()=>{count++;throw Error('network dropped');}});await e.init();
  const job=await e.submit({input,consent:'I_ACCEPT_PROVIDER_CHARGES'});assert.equal(job.status,'submission_unknown');assert.equal(count,1);
  await assert.rejects(e.check(job.id),x=>x.code==='MANUAL_PROVIDER_RECONCILIATION_REQUIRED');
  const restarted=createLocalLiveEngine({root:dir,loadApiKey:async()=>apiKey,enabled:true,capabilityVerified:true,fetchImpl:async()=>{count++;}});await restarted.init();
  await assert.rejects(restarted.submit({input,consent:'I_ACCEPT_PROVIDER_CHARGES'}),x=>x.code==='DAILY_LOCAL_TEST_LIMIT');assert.equal(count,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('unsupported mode/attachment never reaches paid provider',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ds-live-mode-'));let requests=0;
 const e=createLocalLiveEngine({root:dir,loadApiKey:async()=>apiKey,enabled:true,capabilityVerified:true,fetchImpl:async()=>{requests++}});
 try{await e.init();await assert.rejects(e.submit({input:{...input,mode:'first_last'},consent:'I_ACCEPT_PROVIDER_CHARGES'}),x=>x.code==='FIRST_LAST_REQUIRED');assert.equal(requests,0);}finally{await rm(dir,{recursive:true,force:true});}
});
