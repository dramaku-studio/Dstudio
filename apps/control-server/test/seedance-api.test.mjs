import test from 'node:test';import assert from 'node:assert/strict';import {randomBytes} from 'node:crypto';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createLocalConsole} from '../server.mjs';
const png=Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000','hex');
test('Seedance console: authenticated catalog, magic-checked private attachments, previews, persisted drafts',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dramasaku-seedance-http-'));const port=46000+Math.floor(Math.random()*1000),origin=`http://127.0.0.1:${port}`,token='local-test-operator-token-very-long-12345';
 const app=createLocalConsole({port,adminToken:token,vaultKey:randomBytes(32).toString('base64'),vaultFile:join(dir,'vault.json'),assetRoot:join(dir,'seedance')});await app.listen();let cookie='',csrf='';
 const req=async(path,{method='GET',data,headers={}}={})=>{const isBlob=Buffer.isBuffer(data);const r=await fetch(origin+path,{method,headers:{...(cookie?{cookie}:{}),...(method==='GET'?{}:{origin,'sec-fetch-site':'same-origin','x-dramasaku-csrf':csrf,'content-type':isBlob?'application/octet-stream':'application/json'}),...headers},body:method==='GET'?undefined:isBlob?data:JSON.stringify(data??{})});const c=r.headers.get('content-type')||'';const body=c.includes('application/json')?await r.json():null;const session=r.headers.get('set-cookie');if(session?.startsWith('ds_session='))cookie=session.split(';')[0];return {code:r.status,body};};
 try{
  assert.equal((await req('/api/seedance/catalog')).code,401);
  const l=await req('/api/login',{method:'POST',data:{token}});csrf=l.body.csrf;assert.equal(l.code,200);
  const cat=await req('/api/seedance/catalog');assert.equal(cat.code,200);assert.equal(cat.body.paidCallsEnabled,false);assert.equal(cat.body.models.length,4);assert.equal(cat.body.models[0].durationStep,1);assert(cat.body.aspectRatioPresets.some(x=>x.id==='4:5'&&x.native===false));
  const spoofed=await req('/api/seedance/assets',{method:'POST',data:Buffer.from('not a png'),headers:{'x-asset-name':'reference.png'}});assert.equal(spoofed.code,422);
  const badOrigin=await req('/api/seedance/assets',{method:'POST',data:png,headers:{origin:'https://attacker.test'}});assert.equal(badOrigin.code,403);
  const up=await req('/api/seedance/assets',{method:'POST',data:png,headers:{'x-asset-name':'%2e%2e%2fmy-reference.png'}});assert.equal(up.code,201);assert.equal(up.body.asset.name,'my-reference.png');
  const m=up.body.asset.id;assert.match(m,/^[0-9a-f]{24}$/);const media=await fetch(origin+`/api/seedance/assets/${m}/media`,{headers:{cookie}});assert.equal(media.status,200);assert.equal(media.headers.get('content-type'),'image/png');
  const payload={model:'doubao-seedance-2-0-260128',mode:'image_to_video',prompt:'Animate a young filmmaker',duration:5,resolution:'720p',ratio:'9:16',assets:[{assetId:m,role:'first_frame'}]};
  assert.equal((await req('/api/seedance/preview',{method:'POST',data:{...payload,model:'not-available'}})).body.error,'UNSUPPORTED_MODEL');
  const prev=await req('/api/seedance/preview',{method:'POST',data:payload});assert.equal(prev.code,200);const twelve=await req('/api/seedance/preview',{method:'POST',data:{...payload,duration:12,ratio:'21:9'}});assert.equal(twelve.code,200);assert.equal(twelve.body.payload.duration,12);assert.equal(twelve.body.payload.ratio,'21:9');assert.equal((await req('/api/seedance/preview',{method:'POST',data:{...payload,ratio:'4:5'}})).body.error,'INVALID_RATIO');assert.equal(prev.body.status,'prepared_local');assert.equal(prev.body.dispatchable,false);assert.equal(prev.body.payload.content[1].role,'first_frame');
  const created=await req('/api/seedance/jobs',{method:'POST',data:payload});assert.equal(created.code,201);assert.equal(created.body.job.paidCalls,0);assert.equal(created.body.job.status,'prepared_local');
  const jobs=await req('/api/seedance/jobs');assert.equal(jobs.body.jobs.length,1);assert.equal(jobs.body.jobs[0].status,'prepared_local');
  const storedKey=await req('/api/keys',{method:'POST',data:{slot:'volcengine_las',secret:'test-placeholder-not-a-real-key-456'}});assert.equal(storedKey.code,200);
  const keys=await req('/api/keys');assert.equal(keys.body.slots.volcengine_las.configured,true);assert(!JSON.stringify(keys.body).includes('test-placeholder-not-a-real-key-456'));assert(!JSON.stringify(keys.body).includes(token));
  assert.equal((await req('/api/seedance/submit',{method:'POST',data:payload})).code,404);
  const noAuthMedia=await fetch(origin+`/api/seedance/assets/${m}/media`);assert.equal(noAuthMedia.status,401);
 }finally{await new Promise(done=>app.server.close(done));await rm(dir,{recursive:true,force:true});}
});
