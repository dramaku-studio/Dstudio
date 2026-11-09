import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createWorkspaceStore,exportCreativeProject,validateCreativeProject} from '../workspace.mjs';
import {createLocalConsole} from '../server.mjs';

const input={projectName:'Film Portabel',screenplay:'INT. STUDIO - DAY\nRANI\nHalo semua.\nRani membuka pintu.',visualStyle:'Natural cinematic lighting',characters:[{name:'RANI',appearance:'Dark short hair',wardrobe:'Blue jacket'}],shotsPerScene:2,durationSec:5};

function rejectedCode(code){return e=>e?.code===code;}

test('CP019: portable project includes only creative input, version and checksum',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ds019-export-'));
 try{
  const store=createWorkspaceStore({file:join(dir,'workspace.json')});
  await assert.rejects(store.exportPortable(),rejectedCode('PROJECT_NOT_SAVED'));
  await store.save(input);
  const packageData=await store.exportPortable();
  assert.deepEqual(Object.keys(packageData),['kind','version','scope','exportedAt','input','integrity']);
  assert.equal(packageData.scope,'creative-plan-only');
  assert.equal(validateCreativeProject(packageData).input.projectName,'Film Portabel');
  assert.doesNotMatch(JSON.stringify(packageData),/apiKey|vault|providerTaskId|credentials|keyPools|sessionToken/i);
  assert.deepEqual(Object.keys(packageData.input).sort(),['characters','durationSec','projectName','screenplay','shotsPerScene','visualStyle']);
  assert.match(packageData.integrity.inputHash,/^[a-f0-9]{64}$/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('CP019: import rejects tampering and unrecognized fields before modifying local project',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ds019-invalid-'));
 try{
  const store=createWorkspaceStore({file:join(dir,'workspace.json')});await store.save(input);
  const pkg=await store.exportPortable();
  await assert.rejects(store.importPortable({...pkg,input:{...pkg.input,projectName:'Changed'}}),rejectedCode('PROJECT_INTEGRITY_MISMATCH'));
  await assert.rejects(store.importPortable({...pkg,apiKey:'SHOULD_NOT_IMPORT'}),rejectedCode('PROJECT_IMPORT_INVALID'));
  await assert.rejects(store.importPortable({...pkg,input:{...pkg.input,extra:'injection'}}),rejectedCode('PROJECT_IMPORT_INVALID'));
  await assert.rejects(store.importPortable(pkg),rejectedCode('PROJECT_REPLACE_CONFIRMATION_REQUIRED'));
  await assert.rejects(store.importPortable(pkg,{replace:true,expectedCurrentInputHash:'wrong'}),rejectedCode('PROJECT_CHANGED_RELOAD'));
  const still=await store.read();assert.equal(still.workspace.input.projectName,'Film Portabel');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('CP019: export from laptop A and import into B without carrying credentials or jobs',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ds019-migrate-'));
 try{
  const a=createWorkspaceStore({file:join(dir,'laptop-A','creative-workspace.json')});
  const b=createWorkspaceStore({file:join(dir,'laptop-B','creative-workspace.json')});
  await a.save(input);
  const exported=await a.exportPortable();
  const imported=await b.importPortable(JSON.parse(JSON.stringify(exported)));
  assert.equal(imported.plan.planHash,(await a.read()).workspace.plan.planHash);
  assert.equal((await b.read()).workspace.input.projectName,'Film Portabel');
  assert.equal((await readFile(join(dir,'laptop-B','creative-workspace.json'),'utf8')).includes('Blue jacket'),true);
  await b.save({...input,projectName:'Revised'},{expectedCurrentInputHash:exported.integrity.inputHash});
  await assert.rejects(b.importPortable(exported,{replace:true,expectedCurrentInputHash:exported.integrity.inputHash}),rejectedCode('PROJECT_CHANGED_RELOAD'));
  const fresh=(await b.exportPortable()).integrity.inputHash;
  const replaced=await b.importPortable(exported,{replace:true,expectedCurrentInputHash:fresh});
  assert.equal(replaced.input.projectName,'Film Portabel');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('CP019: portable project HTTP routes enforce login and CSRF; never expose vault',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ds019-http-'));
 const port=35000+Math.floor(Math.random()*15000),origin=`http://127.0.0.1:${port}`;
 const app=createLocalConsole({port,adminToken:'test-cp019-token-please-keep-private',vaultKey:randomBytes(32).toString('base64'),vaultFile:join(dir,'vault.enc')});
 let cookie='',csrf='';
 async function req(path,method='GET',body=null,includeCsrf=true){const r=await fetch(origin+path,{method,headers:{...(method==='POST'?{origin,'content-type':'application/json','sec-fetch-site':'same-origin',...(includeCsrf?{'x-dramasaku-csrf':csrf}:{})}:{}),...(cookie?{cookie}:{})},body:method==='POST'?JSON.stringify(body):undefined});return {status:r.status,headers:r.headers,value:await r.json()};}
 try{
  await app.listen();
  assert.equal((await req('/api/workspace/export')).status,401);
  assert.equal((await req('/api/workspace/import','POST',{project:{}})).status,401);
  const login=await req('/api/login','POST',{token:'test-cp019-token-please-keep-private'});assert.equal(login.status,200);
  csrf=login.value.csrf;cookie=login.headers.get('set-cookie').split(';')[0];
  assert.equal((await req('/api/workspace/export')).status,404);
  assert.equal((await req('/api/workspace/save','POST',input)).status,200);
  const exported=await req('/api/workspace/export');assert.equal(exported.status,200);assert.match(exported.headers.get('content-disposition'),/attachment/);
  assert.equal(exported.value.kind,'dramasaku.creative-project');
  assert.equal((await req('/api/workspace/import','POST',{project:exported.value},false)).status,403);
  assert.equal((await req('/api/workspace/import','POST',{project:exported.value})).status,409);
  const hash=(await req('/api/workspace')).value.currentInputHash;
  assert.equal((await req('/api/workspace/import','POST',{project:exported.value,replace:true,expectedCurrentInputHash:hash})).status,200);
  assert.equal((await req('/api/workspace')).value.saved.workspace.input.projectName,input.projectName);
  assert.equal((await req('/api/health')).value.paidCallsEnabled,false);
 }finally{await new Promise(ok=>app.server.close(ok));await rm(dir,{recursive:true,force:true});}
});

test('CP019: operator interface keeps CP017 Video Studio unchanged; project portability has clear scope',async()=>{
 const ui=await readFile(new URL('../ui.html',import.meta.url),'utf8');
 const video=ui.slice(ui.indexOf('id="video-studio"'),ui.indexOf('id="film-studio"'));
 assert.match(video,/id="sd-live-player"/);assert.match(video,/Hasilkan Video/);
 assert.match(ui,/id="project-export"[^>]*>Ekspor Cerita/);assert.match(ui,/id="project-import"[^>]*>Impor Cerita/);
 assert.doesNotMatch(ui,/Character DNA — one character per line|DAG nodes|validated server-side/);
});
