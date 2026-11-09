import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomBytes} from 'node:crypto';
import {createLocalConsole} from '../server.mjs';
const ROOT='http://127.0.0.1:';
test('local operator console: auth, CSRF, vault masking, mock workflow',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dramasaku-console-'));const secret='local-demo-operator-token-for-tests-1234';
 const port=40000+Math.floor(Math.random()*10000);const app=createLocalConsole({port,adminToken:secret,vaultKey:randomBytes(32).toString('base64'),vaultFile:join(dir,'secrets.enc.json')});
 await app.listen();const origin=ROOT+port;
 let cookie='',csrf='';const call=async(path,{method='GET',body,headers={}}={})=>{
   const response=await fetch(origin+path,{method,redirect:'manual',headers:{...(method!=='GET'?{'origin':origin,'sec-fetch-site':'same-origin','x-dramasaku-csrf':csrf,'content-type':'application/json'}:{}),...(cookie?{'cookie':cookie}:{}),...headers},body:method==='GET'?undefined:JSON.stringify(body??{})});
   if(response.headers.get('set-cookie')?.startsWith('ds_session='))cookie=response.headers.get('set-cookie').split(';')[0];
   const contentType=response.headers.get('content-type')||'';const data=contentType.includes('json')?await response.json():null;
   return {status:response.status,headers:response.headers,data};
 };
 try{
   assert.equal((await call('/api/keys')).status,401);
   assert.equal((await call('/api/health')).data.paidCallsEnabled,false);
   assert.equal((await call('/api/login',{method:'POST',body:{token:'wrong'},headers:{origin:'https://evil.test'}})).status,403);
   assert.equal((await call('/api/login',{method:'POST',body:{token:'wrong'}})).status,401);
   const login=await call('/api/login',{method:'POST',body:{token:secret}});assert.equal(login.status,200);csrf=login.data.csrf;assert.match(login.headers.get('set-cookie'),/HttpOnly/);
   assert.equal((await call('/api/keys',{method:'POST',body:{slot:'video',secret:'sample-video-key-value-123'},headers:{'x-dramasaku-csrf':'wrong'}})).status,403);
   assert.equal((await call('/api/keys',{method:'POST',body:{slot:'video',secret:'sample-video-key-value-123'}})).status,200);
   const keys=await call('/api/keys');assert.equal(keys.data.slots.video.configured,true);assert(!JSON.stringify(keys.data).includes('sample-video-key-value-123'));
   assert.equal((await call('/api/keys',{method:'POST',body:{slot:'arbitrary',secret:'sample-video-key-value-123'}})).status,422);
   for(const action of ['plan','approve','review','export','render','publish'])assert.equal((await call(`/api/demo/${action}`,{method:'POST'})).status,200,`step ${action}`);
   const state=await call('/api/demo/state');assert.equal(state.data.step,'completed_dry_run');assert.equal(state.data.manifest.entries.length,4);assert.equal(state.data.publishing.networkCalls,0);
   const video=await fetch(origin+'/api/demo/final.mp4',{headers:{cookie}});assert.equal(video.status,200);assert.equal(video.headers.get('content-type'),'video/mp4');assert((await video.arrayBuffer()).byteLength>1000);
   assert.equal((await call('/api/demo/render',{method:'POST'})).status,422);
   assert.equal((await call('/api/keys/video',{method:'DELETE'})).status,200);
   assert.equal((await call('/api/keys')).data.slots.video.configured,false);
 }finally{await new Promise(resolve=>app.server.close(resolve));await rm(dir,{recursive:true,force:true});}
});
test('server refuses public binding and missing administrative secrets',()=>{
 assert.throws(()=>createLocalConsole({host:'0.0.0.0',adminToken:'x'.repeat(20),vaultKey:randomBytes(32).toString('base64')}),/public bind/);
 assert.throws(()=>createLocalConsole({adminToken:'short',vaultKey:randomBytes(32).toString('base64')}),/20\+/);
});
