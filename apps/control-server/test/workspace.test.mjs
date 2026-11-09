import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {compileWorkspace,createWorkspaceStore} from '../workspace.mjs';
import {createLocalConsole} from '../server.mjs';
const sample={projectName:'First film',screenplay:'INT. ROOM - DAY\nRANI\nHalo.\nRani looks through the window.',visualStyle:'Cinematic interior',characters:[{name:'RANI',appearance:'Adult woman with dark hair',wardrobe:'Red jacket'}],shotsPerScene:2,durationSec:6};
test('unified planner compiles screenplay and character DNA into shot DAG + prompts',()=>{
 const p=compileWorkspace(sample);
 assert.equal(p.story.scenes.length,1);assert.equal(p.plan.shots.length,2);assert(p.plan.nodes.length>=5);
 assert.equal(p.prompts.length,2);assert.match(p.prompts[0].prompt,/Red jacket/);
 assert.equal(p.dna.approval,'PREVIEW_ONLY');assert.match(p.disclaimer,/no paid generation/i);
});
test('workspace rejects missing speaker DNA and invalid boundaries',()=>{
 assert.throws(()=>compileWorkspace({...sample,characters:[{name:'BOB',appearance:'Actor',wardrobe:'blue'}]}),e=>e.code==='DNA_MISMATCH');
 assert.throws(()=>compileWorkspace({...sample,shotsPerScene:0}),e=>e.code==='WORKSPACE_INVALID');
 assert.throws(()=>compileWorkspace({...sample,characters:[sample.characters[0],sample.characters[0]]}),e=>e.code==='WORKSPACE_INVALID');
 assert.throws(()=>compileWorkspace({...sample,screenplay:'tiny'}),e=>e.code==='INVALID_STORY');
});
test('workspace saved with restricted filesystem permissions and restored',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ds-workspace-'));const file=join(dir,'safe','workspace.json');
 try{const store=createWorkspaceStore({file});const w=await store.save(sample);const data=await createWorkspaceStore({file}).read();
 assert.equal(data.workspace.plan.planHash,w.plan.planHash);assert.equal((await stat(file)).mode&0o077,0);
 assert(!JSON.stringify(data).includes('API_KEY_TEST'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('one authenticated local UI serves creative planning and Seedance under a single origin',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ds-unified-'));
 const port=41000+Math.floor(Math.random()*12000);const host=`http://127.0.0.1:${port}`;
 const app=createLocalConsole({port,adminToken:'test-local-token-please-never-use-in-prod',vaultKey:randomBytes(32).toString('base64'),vaultFile:join(dir,'vault.enc')});
 let csrf='',cookie='';
 async function call(path,method='GET',body){const r=await fetch(host+path,{method,headers:{...(method==='POST'?{'content-type':'application/json',origin:host,'sec-fetch-site':'same-origin','x-dramasaku-csrf':csrf}:{}),...(cookie?{cookie}:{})},body:method==='POST'?JSON.stringify(body):undefined});const type=r.headers.get('content-type')||'';const data=type.includes('json')?await r.json():await r.text();return{r,data};}
 try{await app.listen();
  const h=await call('/');assert.equal(h.r.status,200);
  for(const id of ['projects','storyboard','video-studio','workflow','credentials','history','film-studio'])assert(h.data.includes(`id="${id}"`));
  assert.equal((await call('/api/workspace')).r.status,401);
  assert.equal((await call('/api/workspace/preview','POST',sample)).r.status,401);
  const login=await call('/api/login','POST',{token:'test-local-token-please-never-use-in-prod'});assert.equal(login.r.status,200);csrf=login.data.csrf;cookie=login.r.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('/api/workspace/preview','POST',sample)).r.status,200);
  const saved=await call('/api/workspace/save','POST',sample);assert.equal(saved.r.status,200);
  assert.equal(saved.data.workspace.plan.shots.length,2);
  assert.equal((await call('/api/workspace')).data.saved.workspace.input.projectName,'First film');
  const started=await call('/api/demo/plan','POST',{});assert.equal(started.r.status,200);
  const production=await call('/api/demo/state');
  assert.equal(production.data.plan.projectName,'First film');
  assert.equal(production.data.plan.shots.length,2);
  assert.equal(production.data.plan.story.scenes[0].heading,'INT. ROOM - DAY');
  assert.equal((await call('/api/seedance/catalog')).r.status,200);
  assert.equal((await call('/api/workspace/save','POST',{...sample,shotsPerScene:8})).r.status,422);
  assert.equal((await call('/api/workspace/preview','POST',{...sample,characters:[{name:'ALI',appearance:'Adult',wardrobe:'blue'}]})).r.status,422);
  assert.equal((await call('/api/seedance/paid-submit','POST',{})).r.status,404);
 }finally{await new Promise(ok=>app.server.close(ok));await rm(dir,{recursive:true,force:true});}
});
