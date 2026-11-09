import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {createLocalConsole} from '../server.mjs';
const root=dirname(fileURLToPath(import.meta.url));
const ui=await readFile(join(root,'../ui.html'),'utf8');
const app=(await readFile(join(root,'../app.js'),'utf8'))+(await readFile(join(root,'../internal.js'),'utf8'));
const i18n=await readFile(join(root,'../i18n.js'),'utf8');

test('every creative studio has a visible local action; paid actions remain separately gated',()=>{
 for(const [id,label] of [
  ['storyboard-generate','Susun Storyboard'],['image-generate','Simpan Draf Gambar'],
  ['motion-generate','Siapkan di Buat Video'],['sd-live','Hasilkan Video'],
  ['tts-generate','Hasilkan Suara'],['film-generate','Render Film Lokal']]){
  const r=new RegExp(`<button\\b(?=[^>]*\\bid="${id}")[^>]*>${label}<\\/button>`);
  assert.match(ui,r,`${id} must be a visible button`);
  assert(app.includes(`$('${id}').addEventListener('click'`)||app.includes(`$('${id}').onclick`),`${id} must have a handler`);
  assert(i18n.includes(`['${label}'`),`${label} must be translatable`);
 }
 assert(!/id="sd-live"[^>]*\bhidden\b/.test(ui),'video action must not be hidden');
 assert(!/id="tts-generate"[^>]*\bhidden\b/.test(ui),'TTS action must not be hidden');
 assert(ui.includes('id="sd-live-jobs"'),'video live jobs need visible history');
});

test('image status is authenticated and cannot initiate an external charge',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dramasaku-gen-ui-'));
 const port=49000+Math.floor(Math.random()*9000),base=`http://127.0.0.1:${port}`;
 let requests=0;
 const app=createLocalConsole({port,adminToken:'local-test-operator-token-long-enough',vaultKey:randomBytes(32).toString('base64'),vaultFile:join(dir,'vault.enc.json'),liveFetchImpl:async()=>{requests++;throw Error('network forbidden')},ttsFetchImpl:async()=>{requests++;throw Error('network forbidden')}});
 try{
  await app.listen();
  const before=await fetch(base+'/api/image/status');assert.equal(before.status,401);
  const login=await fetch(base+'/api/login',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({token:'local-test-operator-token-long-enough'})});assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const status=await fetch(base+'/api/image/status',{headers:{cookie}});assert.equal(status.status,200);
  const state=await status.json();assert.equal(state.liveAvailable,false);assert.equal(state.paidCalls,false);
  assert.equal(requests,0);
 }finally{await new Promise(r=>app.server.close(r));await rm(dir,{recursive:true,force:true});}
});
