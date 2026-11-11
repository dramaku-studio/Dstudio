import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createLocalConsole} from '../server.mjs';
import {keyOnboardingInput} from '../key-onboarding.mjs';

test('team password rotation, restart, session revocation and provider routing', async t=>{
 const root=await mkdtemp(join(tmpdir(),'local-team-'));
 const port=34000+Math.floor(Math.random()*14000),origin='http://127.0.0.1:'+port;
 const calls=[];
 const options={port,teamLogin:true,adminToken:'unrelated-private-operator-token',vaultKey:randomBytes(32).toString('base64'),vaultFile:join(root,'vault'),keyTestFetchImpl:async(url,request)=>{
  assert.equal(request.method,'GET');assert.equal(request.redirect,'manual');
  calls.push(new URL(url).hostname);
  if(url==='https://api.openai.com/v1/models'){
   assert.equal(request.headers.authorization,'Bearer sk-proj-mock-project-secret');return Response.json({data:[{id:'model-one'}]});
  }
  assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/models');
  assert.equal(request.headers['x-goog-api-key'],'AIza'+'X'.repeat(35));return Response.json({models:[{name:'models/demo'}]});
 }};
 let app=createLocalConsole(options);
 const close=()=>new Promise(resolve=>app.server.close(resolve));
 t.after(async()=>{if(app.server.listening)await close();await rm(root,{recursive:true,force:true});});
 await app.listen();
 const request=(path,body,session={})=>fetch(origin+'/api/'+path,{method:body?'POST':'GET',headers:{origin,'content-type':'application/json',...session},body:body?JSON.stringify(body):undefined});
 const login=async token=>{
  const r=await request('login',{token});assert.equal(r.status,200);
  return {cookie:r.headers.get('set-cookie').split(';')[0],'x-dramasaku-csrf':(await r.json()).csrf};
 };
 const first=await login('654321'),second=await login('654321');
 const next='Team9!';
 const change=(currentPassword,newPassword,session)=>request('team/password',{currentPassword,newPassword},session);
 assert.equal((await change('654321',next,{})).status,401);
 assert.equal((await change('654321',next,{cookie:first.cookie})).status,403);
 assert.equal((await change('wrong',next,first)).status,403);
 for(const weak of ['a1!','abcdef','12345!', 'team12','abc12 '])assert.equal((await change('654321',weak,first)).status,422);
 const unknown=await request('key-pools',{secret:'sk-ambiguous-example-key'},first);
 assert.equal(unknown.status,422);assert.equal((await unknown.json()).error,'KEY_PROVIDER_REQUIRED');assert.deepEqual(calls,[]);
 for(const secret of ['sk-proj-mock-project-secret','AIza'+'X'.repeat(35)]){
  const r=await request('key-pools',{secret},first);assert.equal(r.status,201);assert.equal((await r.json()).connection.state,'connected');
 }
 assert.deepEqual(calls,['api.openai.com','generativelanguage.googleapis.com']);
 assert.equal(keyOnboardingInput({secret:'opaque-demo-key',provider:'aiide'}).group,'video');
 assert.equal((await change('654321',next,first)).status,200);
 for(const s of [first,second])assert.equal((await request('production',null,s)).status,401);
 assert(!(await readFile(join(root,'team-password.json'),'utf8')).includes(next));
 await close();app=createLocalConsole(options);await app.listen();
 for(const token of ['654321',options.adminToken])assert.equal((await request('login',{token})).status,401);
 await login(next);
});
