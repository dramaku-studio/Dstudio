import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {createLocalConsole} from '../server.mjs';
const input={model:'doubao-seedance-2-0-fast-260128',mode:'text_to_video',prompt:'A cinematic slow tracking shot of raindrops against an illuminated city',ratio:'9:16',resolution:'provider_default',duration:5,assets:[]};
const fixture=resolve('fixtures/fixture-video.mp4');
async function harness({enabled=false,verified=false}={}){
 const root=await mkdtemp(join(tmpdir(),'ds-aiide-http-'));
 const video=await readFile(fixture);let posts=0,polls=0,downloads=0;
 const fake=async(url,opts)=>{
  if(url==='https://www.aiide.com/v1/video/generations') {posts++;return Response.json({task_id:'cgt-20261106151600-abcd'});}
  if(url==='https://www.aiide.com/v1/video/generations/cgt-20261106151600-abcd') {polls++;return Response.json({data:{status:'SUCCESS',data:{video_url:'https://video.cdn.example/test.mp4?signature=private'}}});}
  if(url==='https://video.cdn.example/test.mp4?signature=private') {downloads++;return new Response(video,{headers:{'content-type':'video/mp4','content-length':String(video.length)}});}
  throw Error('unexpected URL: '+url);
 };
 const app=createLocalConsole({port:44000+Math.floor(Math.random()*10000),adminToken:'test-aiide-video-operator-1234567',vaultKey:randomBytes(32).toString('base64'),vaultFile:join(root,'secret.enc.json'),aiideVideoEnabled:enabled,aiideVideoCapabilityVerified:verified,aiideVideoFetchImpl:fake,aiideMediaHosts:['video.cdn.example']});
 await app.listen();const base=`http://127.0.0.1:${app.server.address().port}`;let cookie='',csrf='';
 async function call(path,method='GET',body){const r=await fetch(base+path,{method,headers:{...(cookie?{cookie}:{}),...(method!=='GET'?{origin:base,'x-dramasaku-csrf':csrf,'content-type':'application/json'}:{})},body:method==='GET'?undefined:JSON.stringify(body||{})});const set=r.headers.get('set-cookie');if(set?.startsWith('ds_session='))cookie=set.split(';')[0];const json=await r.json();if(json.csrf)csrf=json.csrf;return {status:r.status,data:json};}
 const binary=async(path,headers={})=>fetch(base+path,{headers:{cookie,...headers}});
 return {app,base,call,binary,getStats:()=>({posts,polls,downloads}),close:async()=>{await new Promise(resolve=>app.server.close(resolve));await rm(root,{recursive:true,force:true});}};
}
test('AIIDE local HTTP gate: no login, no key, no capability = no paid request',async()=>{
 const h=await harness();try{
  assert.equal((await h.call('/api/aiide-video/status')).status,401);
  await h.call('/api/login','POST',{token:'test-aiide-video-operator-1234567'});
  await h.call('/api/key-pools','POST',{group:'video',provider:'aiide',label:'Test key',secret:'local-mock-api-key-12345'});
  assert.equal((await h.call('/api/aiide-video/status')).data.configured,true);
  assert.equal((await h.call('/api/aiide-video/submit','POST',{input,consent:'I_ACCEPT_PROVIDER_CHARGES'})).status,403);
  assert.equal(h.getStats().posts,0);
 }finally{await h.close();}
});
test('AIIDE local HTTP: authenticated paid POST > status GET > verified MP4 download',async()=>{
 const h=await harness({enabled:true,verified:true});try{
  await h.call('/api/login','POST',{token:'test-aiide-video-operator-1234567'});
  assert.equal((await h.call('/api/aiide-video/submit','POST',{input,consent:'I_ACCEPT_PROVIDER_CHARGES'})).status,409);
  await h.call('/api/key-pools','POST',{group:'video',provider:'aiide',label:'Test key',secret:'local-mock-api-key-12345'});
  const submit=await h.call('/api/aiide-video/submit','POST',{input,consent:'I_ACCEPT_PROVIDER_CHARGES'});
  assert.equal(submit.status,201);assert.equal(submit.data.job.status,'submitted');
  const task=submit.data.job.id;
  const poll=await h.call(`/api/aiide-video/jobs/${task}/check`,'POST',{});
  assert.equal(poll.status,200);assert.equal(poll.data.job.status,'ready');
  const media=await fetch(`${h.base}/api/aiide-video/jobs/${task}/media`);
  assert.equal(media.status,401);
  const authorized=await h.binary(`/api/aiide-video/jobs/${task}/media`);
  assert.equal(authorized.status,200);assert.equal(authorized.headers.get('content-type'),'video/mp4');
  const raw=new Uint8Array(await authorized.arrayBuffer());assert.equal(String.fromCharCode(...raw.slice(4,8)),'ftyp');
  const gallery=(await h.call('/api/seedance/assets')).data.assets;
  assert.equal(gallery.length,1);
  assert.equal(gallery[0].id,poll.data.job.assetId);
  assert.equal(gallery[0].generatedJobId,task);
  const path='/api/aiide-video/jobs/'+task+'/media';
  const download=await h.binary(path+'?download=1');
  assert.match(download.headers.get('content-disposition'),/^attachment/);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()),await readFile(fixture));
  for(const [range,start,end] of [['bytes=4-7',4,7],['bytes=-8',raw.length-8,raw.length-1]]){
   const partial=await h.binary(path,{range});
   assert.equal(partial.status,206);
   assert.equal(partial.headers.get('content-range'),'bytes '+start+'-'+end+'/'+raw.length);
   assert.deepEqual(new Uint8Array(await partial.arrayBuffer()),raw.slice(start,end+1));
  }
  assert.equal((await h.binary(path,{range:'bytes='+raw.length+'-'})).status,416);
  assert.deepEqual(h.getStats(),{posts:1,polls:1,downloads:1});
  assert.equal((await h.call('/api/aiide-video/submit','POST',{input,consent:'I_ACCEPT_PROVIDER_CHARGES'})).status,429);
 }finally{await h.close();}
});

test('Import AIIDE task by ID: authenticated GET-only recovery, no billable POST, verified MP4',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ds-aiide-recovery-'));
 const video=await readFile(fixture);let posts=0,polls=0,downloads=0;
 const task='task_existing_success_20261106';
 const fake=async(url,opts)=>{
   if(opts.method==='POST'){posts++;throw Error('Remote paid POST must not happen during recovery');}
   if(url==='https://www.aiide.com/v1/video/generations/'+task){polls++;return Response.json({data:{task_id:task,status:'SUCCESS',result_url:'https://ark-acg-ap-southeast-1.tos-ap-southeast-1.volces.com/existing.mp4?sign=redacted'}});}
   if(url==='https://ark-acg-ap-southeast-1.tos-ap-southeast-1.volces.com/existing.mp4?sign=redacted'){downloads++;return new Response(video,{headers:{'content-type':'video/mp4','content-length':String(video.length)}});}
   throw Error('Unexpected remote URL');
 };
 const app=createLocalConsole({port:44000+Math.floor(Math.random()*10000),adminToken:'test-aiide-recovery-operator-1234567',vaultKey:randomBytes(32).toString('base64'),vaultFile:join(root,'secret.enc.json'),aiideReadOnlyEnabled:true,aiideVideoEnabled:false,aiideVideoFetchImpl:fake});
 await app.listen();const base=`http://127.0.0.1:${app.server.address().port}`;let cookie='',csrf='';
 async function call(path,method='GET',body){const r=await fetch(base+path,{method,headers:{...(cookie?{cookie}:{}),...(method!=='GET'?{origin:base,'x-dramasaku-csrf':csrf,'content-type':'application/json'}:{})},body:method==='GET'?undefined:JSON.stringify(body||{})});const set=r.headers.get('set-cookie');if(set?.startsWith('ds_session='))cookie=set.split(';')[0];const data=await r.json();if(data.csrf)csrf=data.csrf;return {status:r.status,data};}
 try{
  assert.equal((await call('/api/aiide-video/import','POST',{providerTaskId:task})).status,401);
  await call('/api/login','POST',{token:'test-aiide-recovery-operator-1234567'});
  assert.equal((await call('/api/aiide-video/import','POST',{providerTaskId:task})).status,409);
  await call('/api/key-pools','POST',{group:'video',provider:'aiide',label:'One approved account',secret:'local-mock-api-key-recovery-12345'});
  const before=await call('/api/aiide-video/status');assert.equal(before.data.readOnlyEnabled,true);assert.equal(before.data.enabled,false);
  assert.equal(before.data.availableAccounts.length,1);
  const imported=await call('/api/aiide-video/import','POST',{providerTaskId:task,keyId:before.data.availableAccounts[0].id});
  assert.equal(imported.status,201);assert.equal(imported.data.job.status,'ready');assert.equal(imported.data.job.source,'imported');
  assert.equal(imported.data.job.providerTaskId,task);assert.equal(imported.data.job.resultHost,'ark-acg-ap-southeast-1.tos-ap-southeast-1.volces.com');
  assert.equal((await call('/api/aiide-video/status')).data.usedToday,0);
  assert.equal((await call('/api/aiide-video/submit','POST',{input,consent:'I_ACCEPT_PROVIDER_CHARGES'})).status,403);
  const same=await call('/api/aiide-video/import','POST',{providerTaskId:task});assert.equal(same.data.job.id,imported.data.job.id);
  const res=await fetch(base+`/api/aiide-video/jobs/${imported.data.job.id}/media`,{headers:{cookie}});assert.equal(res.status,200);
  const media=Buffer.from(await res.arrayBuffer());assert.equal(media.toString('ascii',4,8),'ftyp');
  const creative={projectName:'Recovered task',screenplay:'INT. ROOM - DAY\nRANI\nHello.',visualStyle:'Natural',characters:[{name:'RANI',appearance:'Adult woman',wardrobe:'Red coat'}],shotsPerScene:1,durationSec:5};
  assert.equal((await call('/api/workspace/save','POST',creative)).status,200);
  const attach=await call(`/api/aiide-video/jobs/${imported.data.job.id}/attach`,'POST',{});assert.equal(attach.status,201);assert.equal(attach.data.asset.kind,'video');assert.ok(attach.data.asset.projectId);
  const duplicate=await call(`/api/aiide-video/jobs/${imported.data.job.id}/attach`,'POST',{});assert.equal(duplicate.data.asset.id,attach.data.asset.id);
  assert.deepEqual({posts,polls,downloads},{posts:0,polls:1,downloads:1});
  assert.ok(!(await readFile(join(root,'aiide-video','aiide-video-jobs.json'),'utf8')).includes('local-mock-api-key-recovery'));
 }finally{await new Promise(resolve=>app.server.close(resolve));await rm(root,{recursive:true,force:true});}
});
