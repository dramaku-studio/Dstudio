import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {createLocalConsole} from '../server.mjs';
import {keyOnboardingInput} from '../key-onboarding.mjs';
const secret='mock-aiide-onboarding-secret-123456';
const model='dreamina-seedance-2-5-hc';
test('explicit AIIDE onboarding selects Video; explicit advanced providers are preserved',()=>{
 assert.deepEqual(keyOnboardingInput({secret,provider:'aiide'}),{secret,group:'video',provider:'aiide',label:'AIIDE Video',dailyLimit:100,priority:5,enabled:true});
 const advanced={secret,group:'creative',provider:'openai',label:'Text account'};
 assert.deepEqual(keyOnboardingInput(advanced),advanced);
 for(const input of [null,[],{}, {secret,url:'https://attacker.invalid'}, {secret,provider:'invalid'}, {secret,group:'video'}])assert.throws(()=>keyOnboardingInput(input),/KEY_INPUT_INVALID/);
});
for(const scenario of ['ready','rejected','unsupported','unavailable','offline'])test(`key-only HTTP onboarding: ${scenario}; no paid requests`,async()=>{
 const root=await mkdtemp(join(tmpdir(),'ds-onboard-'));
 const port=35000+Math.floor(Math.random()*18000),origin=`http://127.0.0.1:${port}`;
 let catalogCalls=0,paidCalls=0,cookie='',csrf='';
 const app=createLocalConsole({port,adminToken:'mock-onboarding-operator-token',vaultKey:randomBytes(32).toString('base64'),vaultFile:join(root,'vault.enc'),aiideAutoActivate:scenario!=='offline',
  aiideVideoFetchImpl:async()=>{paidCalls++;throw Error('No paid calls allowed');},
  keyTestFetchImpl:async(url,opts)=>{
   catalogCalls++;assert.equal(url,'https://www.aiide.com/v1/models');assert.equal(opts.method,'GET');assert.equal(opts.headers.authorization,`Bearer ${secret}`);
   if(scenario==='unavailable')throw Error('mock network down');
   if(scenario==='rejected')return new Response('',{status:401});
   return Response.json({data:[{id:scenario==='unsupported'?'deepseek-v4-pro':model}]});
  }});
 async function request(path,method='GET',body,withCsrf=true){const res=await fetch(origin+path,{method,headers:{cookie,origin,'content-type':'application/json',...(withCsrf?{'x-dramasaku-csrf':csrf}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:res.status,body:await res.json(),headers:res.headers};}
 try{
  await app.listen();assert.equal((await request('/api/key-pools','POST',{secret,provider:'aiide'})).status,401);
  const login=await request('/api/login','POST',{token:'mock-onboarding-operator-token'});cookie=login.headers.get('set-cookie').split(';')[0];csrf=login.body.csrf;
  assert.equal((await request('/api/key-pools','POST',{secret,provider:'aiide'},false)).status,403);
  assert.equal((await request('/api/key-pools','POST',{secret,url:'https://attacker.invalid'})).status,422);
  assert.equal((await request('/api/key-pools','POST',{secret:'short'})).status,422);assert.equal(catalogCalls,0);
  const saved=await request('/api/key-pools','POST',{secret,provider:'aiide'});assert.equal(saved.status,201);assert.equal(saved.body.key.group,'video');assert.equal(saved.body.key.provider,'aiide');assert.equal(saved.body.key.label,'AIIDE Video');assert.equal(saved.body.key.usedToday,0);
  assert(!JSON.stringify(saved.body).includes(secret));assert(!(await readFile(join(root,'key-pools.enc.json'),'utf8')).includes(secret));
  assert.equal(catalogCalls,1);
  assert.equal(saved.body.connection.state,scenario==='rejected'?'rejected':scenario==='unavailable'?'unavailable':'connected');
  const status=(await request('/api/aiide-video/status')).body;assert.equal(status.enabled,scenario==='ready');assert.equal(status.jobs.length,0);assert.equal(status.usedToday,0);
  if(scenario==='ready')assert.deepEqual(status.availableModels,[model]);
  assert.equal((await request('/api/aiide-video/submit','POST',{input:{}})).status,403,'Submitting without charge consent stays blocked');
  assert.equal((await request('/api/key-pools','POST',{secret,provider:'aiide'})).status,422,'Duplicate key rejected');
  assert.equal(paidCalls,0);assert.equal(catalogCalls,1);
 }finally{if(app.server.listening)await new Promise(r=>app.server.close(r));await rm(root,{recursive:true,force:true});}
});
