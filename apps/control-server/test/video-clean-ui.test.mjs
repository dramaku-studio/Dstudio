import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {createLocalConsole} from '../server.mjs';
const dir=new URL('../',import.meta.url);
const ui=await readFile(new URL('../ui.html',import.meta.url),'utf8');
const app=await readFile(new URL('../app.js',import.meta.url),'utf8');
const scope=ui.slice(ui.indexOf('id="video-studio"'),ui.indexOf('id="film-studio"'));

test('CP017 clean: one visible Generate Video action, one player, import behind collapsed panel',()=>{
 assert.match(scope,/<button[^>]*id="sd-live"[^>]*>Hasilkan Video<\/button>/);
 assert.equal((scope.match(/id="sd-live-player"/g)||[]).length,1);
 assert.match(scope,/<details class="simple-task-recovery" id="sd-aiide-recovery">/);
 assert.doesNotMatch(scope,/Hasil &amp; Karya|validated server-side|Daftarkan ke AIIDE|Recent video drafts/);
 assert.match(scope,/id="sd-video-download"/);
});

test('CP017 clean: polling checks existing jobs and does not submit paid requests',()=>{
 const block=app.slice(app.indexOf('function sdQueuePoll('),app.indexOf('function sdLiveError('));
 assert.match(block,/setTimeout/);
 assert.match(block,/\/jobs\/\$\{current\.id\}\/check/);
 assert.doesNotMatch(block,/\/submit|I_ACCEPT_PROVIDER_CHARGES/);
 assert.match(app,/function sdShowPlayer\(job\)/);
});

test('localhost CSP allows approved same-origin MP4 and TTS playback',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ds-csp-video-'));
 const port=40000+Math.floor(Math.random()*10000);
 const app=createLocalConsole({port,adminToken:'local-csp-smoke-valid-operator-12345',vaultKey:randomBytes(32).toString('base64'),vaultFile:join(root,'vault.enc.json')});
 try{
  await app.listen();
  const response=await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(response.status,200);
  const csp=response.headers.get('content-security-policy');
  assert.match(csp,/media-src 'self'/);
  assert.match(csp,/default-src 'none'/);
  assert.doesNotMatch(csp,/media-src \*/);
 }finally{await new Promise(resolve=>app.server.close(resolve));await rm(root,{recursive:true,force:true});}
});
