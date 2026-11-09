import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createLocalConsole} from '../server.mjs';
const input={model:'doubao-seedance-2-0-260128',mode:'text_to_video',prompt:'a slow crane shot over a garden',resolution:'720p',ratio:'9:16',duration:5,assets:[]};
const createHarness=async({liveEnabled=false,capabilityVerified=false,fetchImpl=async()=>{throw Error('unexpected network')}}={})=>{
 const root=await mkdtemp(join(tmpdir(),'dramasaku-live-api-'));const app=createLocalConsole({port:41000+Math.floor(Math.random()*8000),adminToken:'testing-local-live-operator-token-very-long',vaultKey:randomBytes(32).toString('base64'),vaultFile:join(root,'vault.enc.json'),liveEnabled,capabilityVerified,liveFetchImpl:fetchImpl});await app.listen();const address=app.server.address(),base=`http://127.0.0.1:${address.port}`;let cookie='',csrf='';
 const call=async(path,method='GET',body)=>{const r=await fetch(base+path,{method,headers:{...cookie?{cookie}:{},...method==='GET'?{}:{origin:base,'content-type':'application/json','x-dramasaku-csrf':csrf}},body:method==='GET'?undefined:JSON.stringify(body??{})});const data=await r.json();const set=r.headers.get('set-cookie');if(set?.startsWith('ds_session='))cookie=set.split(';')[0];if(data.csrf)csrf=data.csrf;return {code:r.status,data};};
 return {app,root,call,close:async()=>{await new Promise(resolve=>app.server.close(resolve));await rm(root,{recursive:true,force:true});}};
};
test('local live HTTP stays disabled by default, even with a configured credential',async()=>{
 let paid=0;const h=await createHarness({fetchImpl:async()=>{paid++;throw Error('unexpected')}});
 try{assert.equal((await h.call('/api/live/status')).code,401);assert.equal((await h.call('/api/login','POST',{token:'testing-local-live-operator-token-very-long'})).code,200);await h.call('/api/keys','POST',{slot:'volcengine_las',secret:'local-test-api-key-123456789'});const st=await h.call('/api/live/status');assert.equal(st.data.enabled,false);const submit=await h.call('/api/live/submit','POST',{input,consent:'I_ACCEPT_PROVIDER_CHARGES'});assert.equal(submit.code,403);assert.equal(paid,0);}finally{await h.close();}
});
test('explicit local activation still requires verified capabilities, and forbids network otherwise',async()=>{
 let paid=0;const h=await createHarness({liveEnabled:true,capabilityVerified:false,fetchImpl:async()=>{paid++;throw Error('unexpected')}});
 try{await h.call('/api/login','POST',{token:'testing-local-live-operator-token-very-long'});await h.call('/api/keys','POST',{slot:'volcengine_las',secret:'local-test-api-key-123456789'});assert.equal((await h.call('/api/live/submit','POST',{input,consent:'I_ACCEPT_PROVIDER_CHARGES'})).code,403);assert.equal(paid,0);}finally{await h.close();}
});
