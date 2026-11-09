import test from 'node:test';import assert from 'node:assert/strict';
import {compileAiideRequest} from '../src/aiide-video-plan.mjs';
import {createAiideVideoAdapter} from '../src/aiide-video-adapter.mjs';
// Independent fixture from the six model-specific AIIDE Model Plaza examples, read 2026-11-09.
const models=['dreamina-seedance-2-0-fast-hc','dreamina-seedance-2-0-hc','dreamina-seedance-2-0-mini-hc','dreamina-seedance-2-5-hc','doubao-seedance-2-0-mini-260615','doubao-seedance-2-5-260628'];
for(const model of models)test(`Model Plaza example payload and same-origin polling: ${model}`,async()=>{
 const url='https://ark-project.tos-cn-beijing.volces.com/doc_image/i2v_foxrgirl.png';
 const input={model,mode:'reference',prompt:'A girl holds a fox, camera slowly pulls back.',ratio:'16:9',resolution:'480p',duration:5,generateAudio:true,watermark:false,assets:[{assetId:'image1',role:'reference_image'}]};
 const plan=compileAiideRequest(input,()=>({id:'image1',kind:'image',providerReference:url,sha256:'1'.repeat(64)}),{forDispatch:true});
 assert.deepEqual(plan.payload,{model,prompt:input.prompt,metadata:{content:[{type:'image_url',image_url:{url},role:'reference_image'}],generate_audio:true,ratio:'16:9',duration:5,resolution:'480p',watermark:false}});
 const calls=[];const adapter=createAiideVideoAdapter({apiKey:'mock-key-not-real-123',modelId:model,networkAllowed:true,fetchImpl:async(url,options)=>{calls.push({url,method:options.method});return options.method==='POST'?Response.json({task_id:'fixture-task-001'}):Response.json({data:{status:'SUCCESS',data:{video_url:'https://fixture.example/result.mp4'}}});}});
 // A supplied arbitrary endpoint cannot redirect the secret; adapter uses the fixed registry.
 const job=await adapter.submit({...plan,endpoint:'https://attacker.invalid'});const result=await adapter.getStatus(job.providerTaskId);assert.equal(result.state,'succeeded');assert.deepEqual(calls,[{url:'https://api.aiide.com/v1/video/generations',method:'POST'},{url:'https://api.aiide.com/v1/video/generations/fixture-task-001',method:'GET'}]);
});
