import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,stat} from 'node:fs/promises';import {tmpdir} from 'node:os';
import {join} from 'node:path';import {randomBytes} from 'node:crypto';
import {createLocalConsole} from '../server.mjs';

test('unified bilingual UI and key management API: auth, provider routing, masked values, live blocked',async()=>{
 const root=await mkdtemp(join(tmpdir(),'dramasaku-cp012-')),port=43000+Math.floor(Math.random()*9000),url=`http://127.0.0.1:${port}`;
 const app=createLocalConsole({port,adminToken:'local-only-testing-admin-access-code-999',vaultKey:randomBytes(32).toString('base64'),vaultFile:join(root,'credentials.enc.json')});
 let csrf='',cookie='';
 async function req(path,{method='GET',body,origin=url,token=csrf}={}){
  const r=await fetch(url+path,{method,headers:{...(method!=='GET'?{origin,'sec-fetch-site':'same-origin','x-dramasaku-csrf':token,'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},body:method==='GET'?undefined:JSON.stringify(body??{})});
  const ct=r.headers.get('content-type')||'';
  return {status:r.status,headers:r.headers,data:ct.includes('json')?await r.json():await r.text()};
 }
 try{
  await app.listen();
  assert.equal((await req('/api/key-pools')).status,401);
  const html=await req('/');assert.equal(html.status,200);
  for(const name of ['id="help"','id="language-switch"','id="keypool-form"','id="pool-list"','id="video-studio"'])assert(html.data.includes(name),name);
  assert(!html.data.includes('CP-010'));
  const lang=await req('/i18n.js');assert.equal(lang.status,200);assert(lang.data.includes('setLanguage'));
  const login=await req('/api/login',{method:'POST',body:{token:'local-only-testing-admin-access-code-999'}});assert.equal(login.status,200);
  csrf=login.data.csrf;cookie=login.headers.get('set-cookie').split(';')[0];
  assert.equal((await req('/api/key-pools',{method:'POST',body:{group:'creative',provider:'aiide',label:'Primary',secret:'CREATIVE-SENSITIVE-KEY-123456',dailyLimit:100},token:'bad'})).status,403);
  const add=await req('/api/key-pools',{method:'POST',body:{group:'creative',provider:'aiide',label:'Primary',secret:'CREATIVE-SENSITIVE-KEY-123456',dailyLimit:100,priority:1}});
  assert.equal(add.status,201);
  const id=add.data.key.id;
  assert(!JSON.stringify(add.data).includes('SENSITIVE'));
  const add2=await req('/api/key-pools',{method:'POST',body:{group:'video',provider:'volcengine',label:'Seedance',secret:'VIDEO-SENSITIVE-KEY-456789',dailyLimit:10}});
  assert.equal(add2.status,201);
  const list=await req('/api/key-pools');assert.equal(list.status,200);
  assert.equal(list.data.pools.length,2);assert(!JSON.stringify(list).includes('SENSITIVE'));
  const wrong=await req('/api/key-pools/preview',{method:'POST',body:{group:'video',provider:'aiide'}});
  assert.equal(wrong.status,200);assert.equal(wrong.data.selected,null);
  const okay=await req('/api/key-pools/preview',{method:'POST',body:{group:'video',provider:'volcengine'}});
  assert.equal(okay.data.selected.label,'Seedance');assert.equal(okay.data.requestsSent,0);
  assert.equal((await req('/api/key-pools/policy',{method:'POST',body:{group:'video',strategy:'round_robin'}})).status,200);
  assert.equal((await req('/api/key-pools/update',{method:'POST',body:{id,enabled:false}})).status,200);
  assert.equal((await req('/api/key-pools/preview',{method:'POST',body:{group:'creative',provider:'aiide'}})).data.selected,null);
  assert.equal((await req('/api/key-pools/paid-submit',{method:'POST',body:{}})).status,404);
  const disk=await readFile(join(root,'key-pools.enc.json'),'utf8');assert(!disk.includes('SENSITIVE'));assert.equal((await stat(join(root,'key-pools.enc.json'))).mode&0o077,0);
  assert.equal((await req('/api/key-pools',{method:'POST',body:{group:'video',provider:'aiide',label:'Evil',secret:'x'.repeat(20)},origin:'https://evil.example'})).status,403);
  assert.equal((await req(`/api/key-pools/${id}`,{method:'DELETE'})).status,200);
 }finally{await new Promise(r=>app.server.close(r));await rm(root,{recursive:true,force:true});}
});
