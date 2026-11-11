import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes,createHash} from 'node:crypto';
import {createWorkspaceStore,portableHash} from '../workspace.mjs';
import {createProductionStore} from '../production.mjs';
import {createProjectPackages} from '../project-package.mjs';
import {createSeedanceLocalStore} from '../../../packages/media/src/seedance-local-store.mjs';
import {createLocalTtsEngine} from '../tts-engine.mjs';
import {testAiideLocally} from '../aiide-local-test.mjs';
import {createLocalConsole} from '../server.mjs';
const creative={projectName:'Internal handoff QA',screenplay:'INT. STUDIO - DAY\nRANI\nAku pulang.\nRani masuk ke studio.',visualStyle:'Cinematic warm light',characters:[{name:'RANI',appearance:'Adult with dark hair',wardrobe:'Red jacket'}],shotsPerScene:1,durationSec:5};
const video=await readFile(new URL('../../../fixtures/fixture-video.mp4',import.meta.url));
// Actual PNG decoded by ffprobe; separate asset IDs exercise frame ordering.
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVXsAAAAASUVORK5CYII=','base64');
const checksum=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
async function harness(){
 const root=await mkdtemp(join(tmpdir(),'studio-internal-')),workspace=createWorkspaceStore({file:join(root,'workspace.json')}),assets=createSeedanceLocalStore({root:join(root,'assets')});await assets.init();
 const production=createProductionStore({root:join(root,'production'),workspace,assets});await production.init();
 const tts=createLocalTtsEngine({root:join(root,'voice'),loadApiKey:async()=>null});await tts.init();
 const packages=createProjectPackages({root,workspace,assets,production,tts});await workspace.save(creative);const projectId=(await workspace.read()).projectId;
 return {root,workspace,assets,production,tts,packages,projectId,expected:async()=>{const s=await production.state();return {expectedProjectHash:s.projectHash,expectedRevision:s.revision};},close:()=>rm(root,{recursive:true,force:true})};
}
test('video drafts restore complete settings, frames and their order after restart; local transport needs no key',async()=>{
 const h=await harness();try{
  const a=await h.assets.addAsset(png,'first.png',{projectId:h.projectId}),b=await h.assets.addAsset(png,'last.png',{projectId:h.projectId});
  const input={model:'doubao-seedance-2-0-fast-260128',mode:'first_last',prompt:'Match the first and final frame.',duration:7,resolution:'provider_default',ratio:'16:9',generateAudio:false,watermark:true,promptLanguage:'en',assets:[{assetId:a.id,role:'first_frame'},{assetId:b.id,role:'last_frame'}]};
  const {job}=await h.assets.createJob(input,{provider:'aiide',projectId:h.projectId});
  const restarted=createSeedanceLocalStore({root:join(h.root,'assets')});await restarted.init();const restored=await restarted.getJob(job.id);
  assert.deepEqual(restored.request,{...input,provider:'aiide',draft:false});
  const result=await testAiideLocally(restored.request,restarted);assert.equal(result.state,'passed_local');assert.equal(result.outboundRequests,0);assert.equal(result.paidCalls,0);assert.equal(result.liveVerified,false);assert.equal(result.plan.missingReferences.length,2);
  const onDisk=await readFile(join(h.root,'assets/index.json'),'utf8');assert.ok(!onDisk.includes('local-contract-fixture-NOT-A-KEY'));
 }finally{await h.close();}
});
test('production revisions reject concurrent edits and story changes invalidate approvals without losing timeline or briefs',async()=>{
 const h=await harness();try{
  const a=await h.assets.addAsset(video,'take.mp4',{projectId:h.projectId});await h.assets.inspectAsset(a.id);
  const snapshot=await h.expected();await h.production.brief({...snapshot,kind:'image',prompt:'A warm room.'});
  await assert.rejects(h.production.brief({...snapshot,kind:'image',prompt:'Stale overwrite.'}),{code:'PRODUCTION_CHANGED_RELOAD'});
  await h.production.review({...await h.expected(),assetId:a.id,reviewer:'Reviewer QA',decision:'approved',note:'Checked actual media'});
  await h.production.timeline({...await h.expected(),clips:[{assetId:a.id,start:0,duration:1}],audioAssetId:null});assert.equal((await h.production.state()).approvedAssets,1);
  const current=await h.workspace.read();await h.workspace.save({...creative,visualStyle:'Revised visual style'},{expectedCurrentInputHash:portableHash(current.workspace.input)});
  const s=await h.production.state();assert.equal(s.projectId,h.projectId);assert.equal(s.approvedAssets,0);assert.equal(s.timeline.clips.length,1);assert.equal(s.briefs.length,1);
  await assert.rejects(h.production.render({...await h.expected()}),{code:'MEDIA_REVIEW_REQUIRED'});
  const restarted=createProductionStore({root:join(h.root,'production'),workspace:h.workspace,assets:h.assets});await restarted.init();assert.equal((await restarted.state()).events.length,3);
 }finally{await h.close();}
});
test('film renders reviewed real local media to playable MP4, preserves inputs and marks old timelines stale',async()=>{
 const h=await harness();try{
  const a=await h.assets.addAsset(video,'take.mp4',{projectId:h.projectId}),before=(await h.assets.readAsset(a.id)).bytes;
  await h.production.timeline({...await h.expected(),clips:[{assetId:a.id,start:0,duration:1}],audioAssetId:null});
  await assert.rejects(h.production.render({...await h.expected()}),{code:'MEDIA_REVIEW_REQUIRED'});
  await h.production.review({...await h.expected(),assetId:a.id,reviewer:'Editor QA',decision:'approved',note:''});
  await h.production.render({...await h.expected()});await assert.rejects(h.production.render({...await h.expected()}),{code:'RENDER_BUSY'});
  let s;for(let i=0;i<120;i++){s=await h.production.state();if(s.renders[0].status!=='rendering')break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(s.renders[0].status,'ready');assert.equal(s.renders[0].current,true);assert.equal(s.renders[0].duration,1);
  const output=await h.production.media(s.renders[0].id),bytes=await readFile(output.path);output.stream.destroy();assert.equal(bytes.toString('ascii',4,8),'ftyp');assert.ok(bytes.length>1000);
  assert.deepEqual((await h.assets.readAsset(a.id)).bytes,before);
  await h.production.timeline({...await h.expected(),clips:[{assetId:a.id,start:0,duration:1.5}],audioAssetId:null});assert.equal((await h.production.state()).renders[0].current,false);
 }finally{await h.close();}
});
test('team package round-trip includes media, ordered drafts, narration, review notes; excludes secrets and requires recipient review',async()=>{
 const source=await harness(),target=await harness();try{
  const a=await source.assets.addAsset(png,'frame.png',{projectId:source.projectId});await source.assets.bindReference(a.id,'https://cdn.example.com/private.png?signature=DO-NOT-EXPORT');
  await source.production.brief({...await source.expected(),kind:'image',prompt:'Hand-painted room.'});
  await source.production.review({...await source.expected(),assetId:a.id,reviewer:'Art director',decision:'approved',note:'Use this frame'});
  await source.production.timeline({...await source.expected(),clips:[{assetId:a.id,start:0,duration:2}],audioAssetId:null});
  await source.assets.createJob({model:'doubao-seedance-2-0-260128',mode:'image_to_video',prompt:'Gentle camera movement.',duration:5,resolution:'provider_default',ratio:'16:9',generateAudio:false,assets:[{assetId:a.id,role:'first_frame'}]},{provider:'aiide',projectId:source.projectId});
  await source.tts.draft({provider:'openai',voice:'coral',language:'id',speed:1.25,text:'Narasi untuk tim.'},{projectId:source.projectId});
  await writeFile(join(source.root,'keys.enc.json'),'SECRET-DO-NOT-EXPORT');
  const bundle=await source.packages.export(),raw=JSON.stringify(bundle);assert.ok(!raw.includes('DO-NOT-EXPORT'));assert.equal(bundle.payload.assets.length,1);assert.equal(bundle.payload.voiceDrafts[0].text,'Narasi untuk tim.');
  const state=await target.production.state();await target.packages.import({bundle,replace:true,expectedCurrentInputHash:state.projectHash,expectedProductionRevision:state.revision});
  const result=await target.production.state();assert.equal(result.projectId,source.projectId);assert.equal(result.approvedAssets,0);assert.equal(result.reviews[0].decision,'revision');assert.equal(result.briefs[0].prompt,'Hand-painted room.');
  assert.notEqual(result.timeline.clips[0].assetId,a.id);assert.deepEqual((await target.assets.readAsset(result.timeline.clips[0].assetId)).bytes,png);
  assert.equal((await target.tts.exportDrafts(source.projectId))[0].text,'Narasi untuk tim.');assert.equal(target.assets.listJobs()[0].provider,'aiide');
  assert.equal(target.assets.listAssets()[0].providerReference,undefined);await assert.rejects(target.production.render({...await target.expected()}),{code:'MEDIA_REVIEW_REQUIRED'});
 }finally{await source.close();await target.close();}
});
test('corrupt/unknown/stale packages fail before the active project or production state changes',async()=>{
 const h=await harness();try{
  const original=await h.packages.export(),before=await h.workspace.read(),state=await h.production.state();
  const badChecksum=structuredClone(original);badChecksum.payload.creative.input.projectName='tampered';assert.throws(()=>h.packages.preview(badChecksum));
  const wrongSchema=structuredClone(original);wrongSchema.payload.keys=['secret'];wrongSchema.sha256=checksum(wrongSchema.payload);assert.throws(()=>h.packages.preview(wrongSchema));
  await assert.rejects(h.packages.import({bundle:original,replace:true,expectedCurrentInputHash:'stale',expectedProductionRevision:state.revision}),{code:'PROJECT_CHANGED_RELOAD'});
  assert.deepEqual(await h.workspace.read(),before);assert.deepEqual(await h.production.state(),state);
 }finally{await h.close();}
});
test('new HTTP routes require session/CSRF; configured API key and successful local mode test never enable paid generation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-internal-http-'));let hits=0;
 const config={port:41000+Math.floor(Math.random()*1000),adminToken:'internal-test-token-long-enough',vaultKey:randomBytes(32).toString('base64'),vaultFile:join(root,'vault.enc.json'),aiideReadOnlyEnabled:true,aiideVideoFetchImpl:async()=>{hits++;throw Error('No external requests');}};
 const app=createLocalConsole(config);await app.listen();const base=`http://127.0.0.1:${config.port}`;
 try{
  for(const path of ['/api/production','/api/aiide-video/catalog','/api/aiide-video/drafts','/api/project-package/export','/api/studio/status'])assert.equal((await fetch(base+path)).status,401);
  const login=await fetch(base+'/api/login',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({token:config.adminToken})}),session=await login.json(),cookie=login.headers.get('set-cookie').split(';')[0];
  const post=async(path,body,csrf=true)=>{const r=await fetch(base+path,{method:'POST',headers:{cookie,origin:base,'content-type':'application/json',...(csrf?{'x-dramasaku-csrf':session.csrf}:{})},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
  assert.equal((await post('/api/production/brief',{},false)).status,403);
  await post('/api/key-pools',{group:'video',provider:'aiide',label:'Fake local test',secret:'dummy-internal-api-key'});
  const input={model:'happyhorse-1.0-t2v',mode:'text_to_video',prompt:'A car drives away.',duration:5,resolution:'720p',ratio:'16:9',assets:[],generateAudio:false};
  const local=await post('/api/aiide-video/test',input);assert.equal(local.status,200);assert.equal(local.data.outboundRequests,0);
  assert.equal((await post('/api/aiide-video/submit',{input,consent:'I_ACCEPT_PROVIDER_CHARGES'})).status,403);assert.equal((await post('/api/tts/generate',{input:{text:'test'},consent:'I_ACCEPT_PROVIDER_CHARGES'})).status,403);
  assert.equal((await(await fetch(base+'/api/health')).json()).paidCallsEnabled,false);assert.equal(hits,0);
 }finally{await new Promise(r=>app.server.close(r));await rm(root,{recursive:true,force:true});}
});

test('identical frame bytes retain separate reference IDs during project import',async()=>{const a=await harness(),b=await harness();try{const first=await a.assets.addAsset(png,'first.png',{projectId:a.projectId}),last=await a.assets.addAsset(png,'last.png',{projectId:a.projectId});await a.assets.createJob({model:'doubao-seedance-2-0-260128',mode:'first_last',prompt:'Loop back to the first frame.',duration:5,resolution:'provider_default',ratio:'16:9',assets:[{assetId:first.id,role:'first_frame'},{assetId:last.id,role:'last_frame'}]},{provider:'aiide',projectId:a.projectId});const state=await b.production.state();await b.packages.import({bundle:await a.packages.export(),replace:true,expectedCurrentInputHash:state.projectHash,expectedProductionRevision:state.revision});const request=(await b.assets.getJob(b.assets.listJobs()[0].id)).request;assert.notEqual(request.assets[0].assetId,request.assets[1].assetId);assert.deepEqual(request.assets.map(x=>x.role),['first_frame','last_frame']);}finally{await a.close();await b.close();}});

test('deleted library media detaches from reviews and timeline, drafts stay editable and export remains portable',async()=>{
 const h=await harness();
 try{
  const a=await h.assets.addAsset(png,'source.png',{projectId:h.projectId});
  await h.production.review({...await h.expected(),assetId:a.id,reviewer:'QA',decision:'approved',note:''});
  await h.production.timeline({...await h.expected(),clips:[{assetId:a.id,start:0,duration:1}]});
  const plan={model:'doubao-seedance-2-0-fast-260128',mode:'image_to_video',prompt:'A frame',duration:5,resolution:'provider_default',ratio:'16:9',assets:[{assetId:a.id,role:'first_frame'}]};
  const {job}=await h.assets.createJob(plan,{provider:'aiide',projectId:h.projectId});
  await h.assets.removeAsset(a.id,h.projectId);await h.production.pruneMissingAssets();
  const state=await h.production.state();assert.equal(state.timeline.clips.length,0);assert.equal(state.reviews.length,0);
  assert.equal((await h.assets.getJob(job.id)).request.prompt,plan.prompt);
  let missing;const bundle=await h.packages.export({onMissingDrafts:n=>{missing=n;}});
  assert.equal(missing,1);assert.equal(h.packages.preview(bundle).assets,0);
 }finally{await h.close();}
});
