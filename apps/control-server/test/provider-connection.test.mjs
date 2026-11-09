import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {createLocalConsole} from '../server.mjs';
import {createProviderConnectionTester} from '../provider-connection.mjs';
const id='a'.repeat(24),secret='disposable-aiide-key-for-local-regression';
function pools(change={}){return {list:async()=>({pools:[{keys:[{id,provider:'aiide',enabled:true,group:'video',...change}]}]}),getForInternalTask:async(keyId,group,provider)=>{assert.equal(keyId,id);assert.equal(group,'video');assert.equal(provider,'aiide');return secret;}};}

test('read-only key verification uses a fixed GET endpoint and does not leak provider payload',async()=>{
 let calls=0,now=100000;
 const tester=createProviderConnectionTester({keyPools:pools(),clock:()=>now,fetchImpl:async(url,options)=>{
  calls++;assert.equal(url,'https://www.aiide.com/v1/models');assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');assert.equal(options.headers.authorization,`Bearer ${secret}`);assert.equal(options.body,undefined);
  return Response.json({data:[{id:'doubao-seedance-2-0-260128'},{id:'some-other-model'}],secretEcho:secret});
 }});
 const result=await tester.test({keyId:id});assert.equal(result.state,'connected');assert.equal(result.modelCount,2);assert.deepEqual(result.matchingVideoModels,['doubao-seedance-2-0-260128']);assert.equal(result.generationCalls,0);assert(!JSON.stringify(result).includes(secret));
 await assert.rejects(tester.test({keyId:id}),{code:'KEY_CHECK_COOLDOWN'});assert.equal(calls,1);
 now+=30000;assert.equal((await tester.test({keyId:id})).state,'connected');assert.equal(calls,2);
});

test('key checks distinguish rejection, rate limit, redirects, malformed responses and network failure',async()=>{
 for(const [response,expected] of [[new Response('secret:'+secret,{status:401}),'rejected'],[new Response('secret:'+secret,{status:403}),'rejected'],[new Response('slow',{status:429}),'rate_limited']]){
  const tester=createProviderConnectionTester({keyPools:pools(),fetchImpl:async()=>response});const result=await tester.test({keyId:id});assert.equal(result.state,expected);assert(!JSON.stringify(result).includes(secret));
 }
 for(const [response,code] of [[new Response(null,{status:302,headers:{location:'https://attacker.invalid'}}),'KEY_CHECK_REDIRECT_REFUSED'],[Response.json({message:secret}),'KEY_CHECK_INVALID_RESPONSE'],[new Response('x',{status:200,headers:{'content-type':'text/html'}}),'KEY_CHECK_INVALID_RESPONSE'],[new Response('x',{headers:{'content-type':'application/json','content-length':'1048577'}}),'KEY_CHECK_RESPONSE_TOO_LARGE']]){
  const tester=createProviderConnectionTester({keyPools:pools(),fetchImpl:async()=>response});await assert.rejects(tester.test({keyId:id}),{code});
 }
 await assert.rejects(createProviderConnectionTester({keyPools:pools(),fetchImpl:async()=>{throw Error(secret);}}).test({keyId:id}),{code:'KEY_CHECK_UNAVAILABLE'});
});

test('disabled or unsupported credentials never leave the backend',async()=>{
 let calls=0;
 for(const [change,code] of [[{enabled:false},'KEY_DISABLED'],[{provider:'other'},'KEY_CHECK_PROVIDER_UNSUPPORTED']]){
  await assert.rejects(createProviderConnectionTester({keyPools:pools(change),fetchImpl:async()=>{calls++;}}).test({keyId:id}),{code});
 }
 assert.equal(calls,0);
});

test('local HTTP: encrypted key survives server restart, feeds provider checker, and cannot enable video generation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ds-key-engine-')),vaultKey=randomBytes(32).toString('base64');
 const port=35000+Math.floor(Math.random()*18000),origin=`http://127.0.0.1:${port}`;let providerCalls=0;
 const config={port,adminToken:'local-key-engine-disposable-operator-token',vaultKey,vaultFile:join(root,'vault.enc'),keyTestFetchImpl:async(url,opts)=>{providerCalls++;assert.equal(opts.method,'GET');assert.equal(opts.headers.authorization,`Bearer ${secret}`);return Response.json({data:[{id:'doubao-seedance-2-0-260128'}]});}};
 let app=createLocalConsole(config),cookie='',csrf='';
 async function request(path,method='GET',body,withCsrf=true){const response=await fetch(origin+path,{method,headers:{...(cookie?{cookie}:{}),...(method==='POST'?{origin,'content-type':'application/json',...(withCsrf?{'x-dramasaku-csrf':csrf}:{})}: {})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json(),headers:response.headers};}
 async function login(){const result=await request('/api/login','POST',{token:config.adminToken});cookie=result.headers.get('set-cookie').split(';')[0];csrf=result.body.csrf;}
 try{
  await app.listen();assert.equal((await request('/api/key-pools/test','POST',{keyId:id})).status,401);await login();
  const created=await request('/api/key-pools','POST',{group:'video',provider:'aiide',label:'Local engine key',secret});assert.equal(created.status,201);const keyId=created.body.key.id;
  assert(!(await readFile(join(root,'key-pools.enc.json'),'utf8')).includes(secret));
  await new Promise(r=>app.server.close(r));app=createLocalConsole(config);await app.listen();cookie='';csrf='';await login();
  assert.equal((await request('/api/key-pools/test','POST',{keyId},false)).status,403);
  assert.equal((await request('/api/key-pools/test','POST',{keyId,url:'https://attacker.invalid'})).status,422);
  const checked=await request('/api/key-pools/test','POST',{keyId});assert.equal(checked.status,200);assert.equal(checked.body.state,'connected');assert(!JSON.stringify(checked.body).includes(secret));assert.equal(providerCalls,1);
  assert.equal((await request('/api/aiide-video/status')).body.configured,true,'Video engine consumes this same saved key pool');
  assert.equal((await request('/api/aiide-video/status')).body.enabled,false);
  assert.equal((await request('/api/aiide-video/submit','POST',{input:{},consent:'I_ACCEPT_PROVIDER_CHARGES'})).status,403);assert.equal(providerCalls,1);
 }finally{if(app.server.listening)await new Promise(r=>app.server.close(r));await rm(root,{recursive:true,force:true});}
});

test('local HTTP: automatic key activation, restart validation and no paid POST',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ds-key-engine-')),vaultKey=randomBytes(32).toString('base64');
 const port=35000+Math.floor(Math.random()*18000),origin=`http://127.0.0.1:${port}`;let providerCalls=0;
 const config={aiideAutoActivate:true,aiideVideoFetchImpl:async()=>{throw Error('Paid network forbidden in HTTP readiness test');},port,adminToken:'local-key-engine-disposable-operator-token',vaultKey,vaultFile:join(root,'vault.enc'),keyTestFetchImpl:async(url,opts)=>{providerCalls++;assert.equal(opts.method,'GET');assert.equal(opts.headers.authorization,`Bearer ${secret}`);return Response.json({data:[{id:'doubao-seedance-2-0-260128'}]});}};
 let app=createLocalConsole(config),cookie='',csrf='';
 async function request(path,method='GET',body,withCsrf=true){const response=await fetch(origin+path,{method,headers:{...(cookie?{cookie}:{}),...(method==='POST'?{origin,'content-type':'application/json',...(withCsrf?{'x-dramasaku-csrf':csrf}:{})}: {})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json(),headers:response.headers};}
 async function login(){const result=await request('/api/login','POST',{token:config.adminToken});cookie=result.headers.get('set-cookie').split(';')[0];csrf=result.body.csrf;}
 try{
  await app.listen();assert.equal((await request('/api/key-pools/test','POST',{keyId:id})).status,401);await login();
  const created=await request('/api/key-pools','POST',{group:'video',provider:'aiide',label:'Local engine key',secret});assert.equal(created.status,201);assert.equal(created.body.connection.state,'connected');assert.equal(providerCalls,1);assert.equal((await request('/api/health')).body.paidCallsEnabled,true);const keyId=created.body.key.id;
  assert(!(await readFile(join(root,'key-pools.enc.json'),'utf8')).includes(secret));
  await new Promise(r=>app.server.close(r));app=createLocalConsole(config);await app.listen();cookie='';csrf='';await login();
  assert.equal((await request('/api/key-pools/test','POST',{keyId},false)).status,403);
  assert.equal((await request('/api/key-pools/test','POST',{keyId,url:'https://attacker.invalid'})).status,422);
  const checked=await request('/api/key-pools/test','POST',{keyId});assert.equal(checked.status,200);assert.equal(checked.body.state,'connected');assert(!JSON.stringify(checked.body).includes(secret));assert.equal(providerCalls,2);
  assert.equal((await request('/api/aiide-video/status')).body.configured,true,'Video engine consumes this same saved key pool');
  assert.equal((await request('/api/aiide-video/status')).body.enabled,true);
  assert.equal((await request('/api/aiide-video/submit','POST',{input:{}})).status,403);assert.equal(providerCalls,2);
 }finally{if(app.server.listening)await new Promise(r=>app.server.close(r));await rm(root,{recursive:true,force:true});}
});
