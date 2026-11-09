import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,stat,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createLocalConsole} from '../server.mjs';
import {createLocalTtsEngine} from '../tts-engine.mjs';
import {createAiideVideoEngine} from '../aiide-video.mjs';
import vm from 'node:vm';
import {compileWorkspace} from '../workspace.mjs';
import {VIDEO_PROMPT_MAX_CHARS} from '../../../packages/providers/src/seedance.mjs';

const input={projectName:'Initial story',screenplay:'INT. STUDIO - DAY\nRANI\nAku pulang.\nRani membuka pintu.',visualStyle:'Natural cinematic light',characters:[{name:'RANI',appearance:'Dark hair',wardrobe:'Red jacket'}],shotsPerScene:2,durationSec:5};
async function harness(){
 const root=await mkdtemp(join(tmpdir(),'ds019-fixes-'));
 const port=35000+Math.floor(Math.random()*20000),origin=`http://127.0.0.1:${port}`;
 let calls=0;const denyNetwork=async()=>{calls++;throw Error('External network forbidden in regression');};
 const app=createLocalConsole({port,adminToken:'disposable-fix-regression-operator-token',vaultKey:randomBytes(32).toString('base64'),vaultFile:join(root,'vault.enc'),liveFetchImpl:denyNetwork,aiideVideoFetchImpl:denyNetwork,ttsFetchImpl:denyNetwork});
 await app.listen();let cookie='',csrf='';
 async function request(path,method='GET',body,includeCsrf=true){
  const response=await fetch(origin+path,{method,headers:{...(cookie?{cookie}:{}),...(method==='POST'?{origin,'content-type':'application/json',...(includeCsrf?{'x-dramasaku-csrf':csrf}:{})}: {})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,body:await response.json(),headers:response.headers};
 }
 const login=await request('/api/login','POST',{token:'disposable-fix-regression-operator-token'});
 cookie=login.headers.get('set-cookie').split(';')[0];csrf=login.body.csrf;
 return {root,app,request,calls:()=>calls,close:async()=>{await new Promise(r=>app.server.close(r));await rm(root,{recursive:true,force:true});}};
}

test('F1: stale saves and simultaneous first saves return conflicts without overwriting work',async()=>{
 const h=await harness();try{
  const first=await h.request('/api/workspace/save','POST',input);assert.equal(first.status,200);
  const tabA=(await h.request('/api/workspace')).body.currentInputHash;
  const newer=await h.request('/api/workspace/save','POST',{...input,projectName:'Tab B newer',expectedCurrentInputHash:tabA});assert.equal(newer.status,200);
  const stale=await h.request('/api/workspace/save','POST',{...input,projectName:'Tab A stale',expectedCurrentInputHash:tabA});assert.equal(stale.status,409);assert.equal(stale.body.error,'PROJECT_CHANGED_RELOAD');
  assert.equal((await h.request('/api/workspace/save','POST',input)).status,409,'omitting revision cannot bypass check');
  assert.equal((await h.request('/api/workspace')).body.saved.workspace.input.projectName,'Tab B newer');
  const results=await Promise.all(['Tab A','Tab B'].map(projectName=>h.request('/api/workspace/save','POST',{...input,projectName,expectedCurrentInputHash:newer.body.currentInputHash})));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(h.calls(),0);
 }finally{await h.close();}
 const empty=await harness();try{
  const results=await Promise.all(['A','B'].map(projectName=>empty.request('/api/workspace/save','POST',{...input,projectName,expectedCurrentInputHash:null})));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const winner=results.find(r=>r.status===200);assert.equal((await empty.request('/api/workspace')).body.saved.workspace.input.projectName,winner.body.workspace.input.projectName);
 }finally{await empty.close();}
});

test('F5: narration and voice settings restore after engine restart; legacy drafts remain readable as metadata',async()=>{
 const h=await harness();try{
  const speech={provider:'aiide',voice:'nova',language:'en',speed:1.25,text:'  Narasi lengkap: café, 東京, dan dialog asli.  '};
  const draft=await h.request('/api/tts/draft','POST',speech);assert.equal(draft.status,201);assert.equal(draft.body.job.draftAvailable,true);
  const id=draft.body.job.id;
  const unauthorized=await fetch(`http://127.0.0.1:${h.app.server.address().port}/api/tts/jobs/${id}/draft`);assert.equal(unauthorized.status,401);
  const restarted=createLocalTtsEngine({root:join(h.root,'tts-audio'),loadApiKey:async()=>null,fetchImpl:async()=>{throw Error('Forbidden');}});await restarted.init();
  assert.deepEqual((await restarted.readDraft(id)).input,{...speech,text:speech.text.trim()});
  assert.deepEqual((await h.request(`/api/tts/jobs/${id}/draft`)).body.draft.input,{...speech,text:speech.text.trim()});
  assert.equal(JSON.stringify((await h.request('/api/tts/status')).body).includes('Narasi lengkap'),false,'list does not expose narration text');
  if(process.platform!=='win32')assert.equal((await stat(join(h.root,'tts-audio',`${id}.draft.json`))).mode&0o077,0);
  const file=join(h.root,'tts-audio','tts-index.json');const index=JSON.parse(await readFile(file,'utf8'));
  delete index.entries[0].hasDraftText;await writeFile(file,JSON.stringify(index));
  const legacy=createLocalTtsEngine({root:join(h.root,'tts-audio'),loadApiKey:async()=>null});await legacy.init();
  assert.equal((await legacy.list()).jobs[0].draftAvailable,false);
  await assert.rejects(legacy.readDraft(id),{code:'TTS_DRAFT_TEXT_UNAVAILABLE'});
  assert.equal(h.calls(),0);
 }finally{await h.close();}
});

test('F5: corrupted narration is refused and drafting stays free even when generation is requested',async()=>{
 const h=await harness();try{
  const speech={provider:'openai',voice:'coral',language:'id',speed:1,text:'Teks narasi yang disimpan.'};
  const draft=(await h.request('/api/tts/draft','POST',speech)).body.job;
  await writeFile(join(h.root,'tts-audio',`${draft.id}.draft.json`),JSON.stringify({version:1,input:{...speech,text:'Teks diubah tanpa versi.'}}));
  assert.equal((await h.request(`/api/tts/jobs/${draft.id}/draft`)).status,409);
  assert.equal((await h.request('/api/tts/generate','POST',{input:speech,consent:'I_ACCEPT_PROVIDER_CHARGES'})).status,403);
  assert.equal(h.calls(),0);
 }finally{await h.close();}
});

test('F3: legacy succeeded checkpoints recover without network or resubmission and preserve task identity',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ds019-recovery-'));let requests=0;
 const keyId='b'.repeat(24),id='a'.repeat(24),task='task_existing_success';
 const keyPool={getForInternalTask:async k=>{assert.equal(k,keyId);return 'disposable-provider-key';},preview:async()=>({selected:null}),list:async()=>({pools:[]})};
 const config={root,keyPool,readOnlyEnabled:true,fetchImpl:async(url,options)=>{requests++;assert.equal(options.method,'GET');assert.match(url,new RegExp(task));return Response.json({data:{status:'RUNNING'}});}};
 try{
  const file=join(root,'aiide-video-jobs.json');
  await writeFile(file,JSON.stringify({version:1,jobs:[{id,keyId,source:'imported',status:'succeeded',providerTaskId:task,createdAt:new Date().toISOString()}]}));
  const engine=createAiideVideoEngine(config);await engine.init();assert.equal(requests,0);
  const saved=JSON.parse(await readFile(file,'utf8'));assert.equal(saved.jobs[0].status,'download_pending');assert.equal(saved.jobs[0].providerTaskId,task);assert.equal(saved.jobs[0].keyId,keyId);
  const restart=createAiideVideoEngine(config);await restart.init();assert.equal(requests,0);
  assert.equal((await restart.check(id)).status,'running');assert.equal(requests,1);
  saved.jobs[0].status='invented-state';await writeFile(file,JSON.stringify(saved));
  await assert.rejects(createAiideVideoEngine(config).init(),{code:'AIIDE_HISTORY_CORRUPT'});
 }finally{await rm(root,{recursive:true,force:true});}
});

test('F3: successful imports persist a restartable download state even when output URL is missing',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ds019-import-'));let requests=0;
 const keyId='c'.repeat(24);
 const keyPool={getForInternalTask:async()=> 'disposable-provider-key',preview:async()=>({selected:null}),list:async()=>({pools:[{id:'video',keys:[{id:keyId,provider:'aiide',enabled:true}]}]})};
 const config={root,keyPool,readOnlyEnabled:true,fetchImpl:async(url,options)=>{requests++;assert.equal(options.method,'GET');return Response.json({data:{status:'SUCCESS'}});}};
 try{
  const engine=createAiideVideoEngine(config);await engine.init();
  const job=await engine.importTask({providerTaskId:'task_already_done',keyId});assert.equal(job.status,'download_pending');assert.equal(job.errorCode,'AIIDE_NO_VIDEO_URL');
  const restarted=createAiideVideoEngine(config);await restarted.init();assert.equal((await restarted.list()).jobs[0].id,job.id);assert.equal(requests,1);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('F2: terminal/error jobs cannot block polling older active jobs; poller only checks existing tasks',async()=>{
 const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
 const polling=source.slice(source.indexOf('let sdPollTimer='),source.indexOf('function sdLiveError'));
 for(const blocker of [{status:'failed'},{status:'cancelled'},{status:'submission_unknown'},{status:'download_pending',errorCode:'AIIDE_RESULT_HOST_NOT_APPROVED'}]){
  const timers=[],calls=[];
  const context={setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout:()=>{},location:{hash:'#video-studio'},sdLiveBase:()=>'/api/aiide-video',sdText:()=>{},sdRenderLiveJobs:async()=>{},api:async(path,options)=>{calls.push({path,options});return {job:{status:'ready'}};}};
  vm.createContext(context);vm.runInContext(polling,context);
  context.snapshot={jobs:[{id:'blocked',...blocker},{id:'older-running',status:'running'}]};
  vm.runInContext('sdQueuePoll(snapshot)',context);assert.equal(timers.length,1);
  await timers.shift()();assert.equal(calls.length,1);assert.equal(calls[0].path,'/api/aiide-video/jobs/older-running/check');
  assert.equal(calls[0].options.method,'POST');assert.deepEqual(JSON.parse(JSON.stringify(calls[0].options.body)),{});
  assert.equal(calls.some(c=>c.path.includes('submit')),false);
 }
 const timers=[];const context={setTimeout:fn=>timers.push(fn),clearTimeout:()=>{}};vm.createContext(context);vm.runInContext(polling,context);
 context.snapshot={jobs:[{status:'failed'},{status:'ready'},{status:'submission_unknown'}]};vm.runInContext('sdQueuePoll(snapshot)',context);assert.equal(timers.length,0);
});

test('F4: long storyboard prompts remain intact and can be edited into a valid video draft',async()=>{
 const h=await harness();try{
  const longInput={...input,screenplay:'INT. STUDIO - DAY\nRANI\nDialog ini tidak boleh berubah.\n'+('Deskripsi panjang aksi Rani. '.repeat(180))};
  const compiled=compileWorkspace(longInput),original=compiled.prompts[0].prompt;
  assert(original.length>VIDEO_PROMPT_MAX_CHARS);assert.match(original,/Dialog ini tidak boleh berubah/);
  const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
  const helper=source.slice(source.indexOf('function transferVideoPrompt('),source.indexOf('function renderWorkspace('));
  function element(tag){return {tag,children:[],value:'',events:{},attributes:{},append(...nodes){this.children.push(...nodes);},setAttribute(k,v){this.attributes[k]=v;},addEventListener(k,fn){this.events[k]=fn;}};}
  const catalog=(await h.request('/api/seedance/catalog')).body;let navigation=null;const destination={value:'untouched'};
  const context={document:{createElement:element},sdCatalog:catalog,$:()=>destination,openView:view=>{navigation=view;},sdText:()=>{}};vm.createContext(context);vm.runInContext(helper,context);
  context.prompt=original;const ui=vm.runInContext('createStoryboardPromptEditor(prompt,"SC-001-SH-01")',context);
  const editor=ui.children[0].children[0],counter=ui.children[1],button=ui.children[2];
  assert.equal(editor.value,original,'never silently truncate the story or dialogue');assert.equal(button.disabled,true);assert.match(counter.textContent,/Ringkas/);
  assert.equal(vm.runInContext('transferVideoPrompt(prompt,"image-status")',context),false,'other Studio transfers enforce the same boundary');
  button.events.click();assert.equal(destination.value,'untouched');assert.equal(navigation,null);
  const edited='Wide shot. Rani membuka pintu. Red jacket. Dialogue RANI: Dialog ini tidak boleh berubah.';
  editor.value=edited;editor.events.input();assert.equal(button.disabled,false);button.events.click();assert.equal(destination.value,edited);assert.equal(navigation,'video-studio');
  assert.equal(compiled.prompts[0].prompt,original);assert.equal(compiled.input.screenplay,longInput.screenplay.trim());
  const video={model:catalog.models[0].id,mode:'text_to_video',prompt:edited,ratio:'16:9',resolution:'720p',duration:5,assets:[]};
  assert.equal((await h.request('/api/seedance/preview','POST',{...video,prompt:original})).status,422);
  assert.equal((await h.request('/api/seedance/preview','POST',video)).status,200);
  assert.equal((await h.request('/api/seedance/jobs','POST',video)).status,201);
  editor.value=' ';editor.events.input();assert.equal(button.disabled,true);
  assert.equal(h.calls(),0);
 }finally{await h.close();}
});
