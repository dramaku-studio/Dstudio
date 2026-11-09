import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHttpVideoBridge,ProviderTransportError} from '../src/http-video-bridge.mjs';
import {startFixtureBridge} from '../src/fixture-bridge.mjs';
import {createLocalVideoStore,AssetIntegrityError} from '../../media/src/local-store.mjs';
const exec=promisify(execFile);
let folder,server,api,fixture;
before(async()=>{
 folder=await mkdtemp(join(tmpdir(),'dramasaku-cp003-test-'));
 fixture=join(folder,'sample.mp4');
 await exec('ffmpeg',['-loglevel','error','-y','-f','lavfi','-i','testsrc2=size=256x144:rate=12','-t','1',
 '-c:v','mpeg4','-q:v','6','-movflags','+faststart',fixture],{timeout:20000});
 server=await startFixtureBridge({mp4Path:fixture});
 api=createHttpVideoBridge({baseUrl:server.url,token:server.token,allowInsecureLoopback:true});
});
after(async()=>{await server?.close();await rm(folder,{recursive:true,force:true});});
test('HTTP bridge submit, status, MP4 bytes and sha256 verified end-to-end',async()=>{
 const submit=await api.submit({prompt:'a shot'},{clientReference:'success_01'});
 assert.equal(submit.outcome,'accepted');
 const status=await api.getStatus(submit.externalTaskId);
 assert.equal(status.state,'succeeded');assert.equal(status.actualMinor,125);
 const file=await api.openVideo(submit.externalTaskId);
 const store=createLocalVideoStore({root:join(folder,'assets')});
 const result=await store.ingest(file);
 assert.match(result.sha256,/^[0-9a-f]{64}$/);assert.equal(result.width,256);assert.equal(result.height,144);
 assert.ok(result.durationSeconds>0);assert.ok(result.bytes>1000);
});
test('paid POST requires explicit key, rejects traversal in task path',async()=>{
 await assert.rejects(()=>api.submit({prompt:'hi'},{}),e=>e.code==='INVALID_REQUEST');
 await assert.rejects(()=>api.getStatus('../admin'),e=>e.code==='INVALID_REQUEST');
 await assert.rejects(()=>api.openVideo('bad/id'),e=>e.code==='INVALID_REQUEST');
});
test('bridge rejects untrusted non-HTTPS and URL credentials',()=>{
 assert.throws(()=>createHttpVideoBridge({baseUrl:'http://evil.example',token:server.token}),/HTTPS/);
 assert.throws(()=>createHttpVideoBridge({baseUrl:'https://admin:pass@example.com/',token:server.token}),/origin only/);
 assert.throws(()=>createHttpVideoBridge({baseUrl:'http://0.0.0.0:1234',token:server.token,allowInsecureLoopback:true}),/HTTPS/);
});
test('unexpected 502 / redirect response on POST is ambiguous (not safe to auto-retry)',async()=>{
 let calls=0;
 const bridge=createHttpVideoBridge({baseUrl:'https://bridge.example',token:server.token,fetchImpl:async()=>{calls++;return new Response('{}',{status:502,headers:{'content-type':'application/json'}});}});
 await assert.rejects(()=>bridge.submit({prompt:'test'},{clientReference:'failed_once'}),e=>e instanceof ProviderTransportError&&e.ambiguous);
 assert.equal(calls,1);
});
test('explicit definitely-not-accepted rejection can release a hold',async()=>{
 const bridge=createHttpVideoBridge({baseUrl:'https://bridge.example',token:server.token,
 fetchImpl:async()=>new Response(JSON.stringify({definitely_not_accepted:true,code:'BAD_PROMPT'}),{status:422,headers:{'content-type':'application/json'}})});
 const res=await bridge.submit({prompt:'test'},{clientReference:'reject_once'});
 assert.deepEqual(res,{outcome:'rejected',definitelyNotAccepted:true,code:'BAD_PROMPT'});
});
test('video store rejects forged MP4 header and removes partial files',async()=>{
 const dest=join(folder,'bad-assets');
 const store=createLocalVideoStore({root:dest});
 await assert.rejects(()=>store.ingest({stream:new Blob(['NOT A VIDEO']).stream()}),e=>e instanceof AssetIntegrityError);
 assert.deepEqual(await readdir(dest),[]);
});
test('video store blocks oversized streaming payload',async()=>{
 const dest=join(folder,'oversized-assets');
 const store=createLocalVideoStore({root:dest,maxBytes:1024});
 await assert.rejects(()=>store.ingest({stream:new Blob([Buffer.alloc(2000)]).stream()}),e=>e instanceof AssetIntegrityError);
 assert.deepEqual(await readdir(dest),[]);
});
test('video store rejects valid-looking header with invalid MP4 moov/readability',async()=>{
 const dest=join(folder,'badmoov-assets');const store=createLocalVideoStore({root:dest});
 const fake=Buffer.from('00000018667479706d70343200000000','hex');
 await assert.rejects(()=>store.ingest({stream:new Blob([fake]).stream()}),e=>e instanceof AssetIntegrityError);
 assert.deepEqual(await readdir(dest),[]);
});
test('strict media size mismatch prevents storing truncated response',async()=>{
 const dest=join(folder,'truncated-assets');const store=createLocalVideoStore({root:dest});
 await assert.rejects(()=>store.ingest({stream:new Blob([Buffer.alloc(1500)]).stream(),length:2000}),e=>e instanceof AssetIntegrityError);
 assert.deepEqual(await readdir(dest),[]);
});
