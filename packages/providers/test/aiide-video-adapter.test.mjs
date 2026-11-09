import test from 'node:test';
import assert from 'node:assert/strict';
import {createAiideVideoAdapter,compileAiideVideoPayload,AIIDE_VIDEO_CREATE,AIIDE_VIDEO_STATUS} from '../src/aiide-video-adapter.mjs';
import {compileAiideRequest} from '../src/aiide-video-plan.mjs';
const plan=compileAiideRequest({model:'doubao-seedance-2-0-fast-260128',mode:'text_to_video',prompt:'Cinematic neon reflections, gentle tracking shot',duration:5,resolution:'provider_default',ratio:'9:16',assets:[]},()=>null);
test('AIIDE request compiler maps the documented native Seedance metadata shape',()=>{
 const body=compileAiideVideoPayload(plan);assert.equal(body.metadata.duration,5);assert.equal(body.metadata.ratio,'9:16');assert.equal(body.model,plan.model);
 assert.ok(!('api_key' in body));
});
test('AIIDE adapter uses verified URLs, bearer key, and returns provider task id',async()=>{
 const seen=[];const fetchImpl=async(url,opts)=>{seen.push({url,method:opts.method,authorization:opts.headers.authorization,body:opts.body});return Response.json({id:'cgt-20261106000000-abc42',task_id:'cgt-20261106000000-abc42',status:'SUBMITTED'});};
 const adapter=createAiideVideoAdapter({apiKey:'dummy-test-api-key-12345',networkAllowed:true,fetchImpl});const response=await adapter.submit(plan);
 assert.equal(response.providerTaskId,'cgt-20261106000000-abc42');assert.equal(seen[0].url,'https://www.aiide.com/v1/video/generations');assert.equal(seen[0].method,'POST');assert.equal(seen[0].authorization,'Bearer dummy-test-api-key-12345');
 const data=JSON.parse(seen[0].body);assert.equal(data.metadata.duration,5);assert.equal(data.metadata.ratio,'9:16');
});
test('AIIDE status parser supports documented nested status and result',async()=>{
 const calls=[];const fetchImpl=async url=>{calls.push(url);return Response.json({code:'0',data:{status:'SUCCESS',data:{status:'succeeded',video_url:'https://cdn.example.com/video.mp4?token=signed'}}});};
 const a=createAiideVideoAdapter({apiKey:'dummy-test-api-key-12345',networkAllowed:true,fetchImpl});const status=await a.getStatus('cgt-20261106000000-abc42');
 assert.equal(status.state,'succeeded');assert.equal(status.videoUrl,'https://cdn.example.com/video.mp4?token=signed');assert.equal(calls[0],AIIDE_VIDEO_STATUS+'cgt-20261106000000-abc42');
});
test('network disabled blocks paid requests, uncertain response is not retried',async()=>{
 let posts=0;const fetchImpl=async()=>{posts++;return Response.json({message:'weird, task maybe accepted'}, {status:502});};
 const a=createAiideVideoAdapter({apiKey:'dummy-test-api-key-12345',networkAllowed:false,fetchImpl});await assert.rejects(a.submit(plan),{code:'AIIDE_NETWORK_DISABLED'});assert.equal(posts,0);
 const active=createAiideVideoAdapter({apiKey:'dummy-test-api-key-12345',networkAllowed:true,fetchImpl});await assert.rejects(active.submit(plan),{code:'AIIDE_SUBMISSION_UNKNOWN'});assert.equal(posts,1);
});

test('AIIDE status parser accepts documented outer data.result_url with SUCCESS', async()=>{
 const fetchImpl=async()=>Response.json({code:'success',data:{task_id:'task_existing_12345',status:'SUCCESS',progress:'100%',result_url:'https://cdn.approved.example/render.mp4?signature=secret'}});
 const adapter=createAiideVideoAdapter({apiKey:'dummy-test-api-key-12345',networkAllowed:true,fetchImpl});
 const status=await adapter.getStatus('task_existing_12345');
 assert.equal(status.state,'succeeded');
 assert.equal(status.videoUrl,'https://cdn.approved.example/render.mp4?signature=secret');
});

test('AIIDE inner upstream status takes precedence over outer accepted status', async()=>{
 const fetchImpl=async()=>Response.json({code:'success',data:{status:'SUCCESS',data:{status:'running',video_url:null}}});
 const adapter=createAiideVideoAdapter({apiKey:'dummy-test-api-key-12345',networkAllowed:true,fetchImpl});
 const status=await adapter.getStatus('task_existing_12345');
 assert.equal(status.state,'running');assert.equal(status.videoUrl,null);
});
