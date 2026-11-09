import test from 'node:test';
import assert from 'node:assert/strict';
import {AIIDE_MODELS,aiideVideoCatalog,compileAiideRequest,validateProviderReference} from '../src/aiide-video-plan.mjs';
import {createAiideVideoAdapter} from '../src/aiide-video-adapter.mjs';
const assets={
 a:{id:'a',kind:'image',sha256:'1'.repeat(64),width:600,height:600,providerReference:'https://cdn.example.com/start.png'},
 b:{id:'b',kind:'image',sha256:'2'.repeat(64),width:600,height:600,providerReference:'https://cdn.example.com/end.png'},
 v:{id:'v',kind:'video',sha256:'3'.repeat(64),width:480,height:854,durationSeconds:4,fps:24,providerReference:'https://cdn.example.com/motion.mp4'},
 a1:{id:'a1',kind:'audio',sha256:'4'.repeat(64),durationSeconds:4,providerReference:'https://cdn.example.com/sound.mp3'}
};
function request(model,mode){return {model:model.id,mode,prompt:'A camera slowly follows the subject.',ratio:model.ratioOptions[0],resolution:model.resolutions[0],duration:model.minDuration===-1?-1:Math.max(5,model.minDuration)>model.maxDuration?model.maxDuration:Math.max(5,model.minDuration),generateAudio:model.supportsAudio,watermark:false,assets:mode==='text_to_video'?[]:mode==='image_to_video'?[{assetId:'a',role:'first_frame'}]:mode==='first_last'?[{assetId:'a',role:'first_frame'},{assetId:'b',role:'last_frame'}]:mode==='edit'?[{assetId:'v',role:'reference_video'},{assetId:'a',role:'reference_image'}]:[{assetId:'a',role:'reference_image'}]};}
for(const model of AIIDE_MODELS)for(const mode of model.modes)test(`AIIDE contract: ${model.id} / ${mode}`,async()=>{
 const input=request(model,mode),plan=compileAiideRequest(input,id=>assets[id],{forDispatch:true}),sent=[];
 const a=createAiideVideoAdapter({apiKey:'dummy-no-real-key-123',networkAllowed:true,fetchImpl:async(url,opts)=>{sent.push({url,...opts});return Response.json({task_id:'contract-task-00001'});}});
 await a.submit(plan);assert.equal(sent.length,1);assert.equal(sent[0].url,plan.endpoint);assert.equal(sent[0].redirect,'manual');
 const body=JSON.parse(sent[0].body);assert.equal(body.model,model.id);assert.equal(body.prompt,input.prompt);assert.ok(!JSON.stringify(body).includes('dummy-no-real-key'));
 if(model.family==='seedance'){assert.ok(!('seconds' in body));assert.equal(body.metadata.duration,input.duration);assert.equal(body.metadata.generate_audio,true);if(mode==='first_last'){assert.equal(body.metadata.first_frame_image,assets.a.providerReference);assert.equal(body.metadata.last_frame_image,assets.b.providerReference);}}
 if(model.family==='happyhorse'){assert.equal(body.metadata.parameters.resolution,'720P');if(mode==='edit'){assert.equal(body.input_reference,assets.v.providerReference);assert.ok(!('duration' in body.metadata.parameters));}if(mode==='image_to_video')assert.equal(body.input_reference,assets.a.providerReference);}
 if(model.family==='sora'){assert.equal(body.seconds,String(input.duration));assert.equal(body.video_config.resolution_name,'480p');}
 if(model.family==='veo'){assert.equal(body.size,'1280x720');assert.ok(!('seconds' in body));}
});
test('unsupported modes/models/flags cannot be enabled by attaching a key',()=>{
 const input=request(AIIDE_MODELS[0],'text_to_video');
 for(const override of [{mode:'extend'},{model:'doubao-seedance-2-5-260628'},{model:'attacker-model'},{resolution:'1080p'},{seed:1},{draft:true},{duration:30}])assert.throws(()=>compileAiideRequest({...input,...override}));
 assert.equal(aiideVideoCatalog().modes.find(m=>m.id==='extend').disabled,true);
});
test('references enforce roles, counts, dimensions, duration, audio limits and explicit staging',()=>{
 const model=AIIDE_MODELS[0],input=request(model,'image_to_video');
 assert.throws(()=>compileAiideRequest({...input,assets:[]},id=>assets[id]),{code:'FIRST_FRAME_REQUIRED'});
 assert.throws(()=>compileAiideRequest({...input,mode:'first_last'},id=>assets[id]),{code:'FIRST_LAST_REQUIRED'});
 assert.throws(()=>compileAiideRequest({...input,mode:'text_to_video'},id=>assets[id]),{code:'UNEXPECTED_REFERENCES'});
 const local=id=>({...assets[id],providerReference:undefined});const plan=compileAiideRequest(input,local);assert.deepEqual(plan.missingReferences,['a']);assert.equal(plan.dispatchable,false);
 assert.throws(()=>compileAiideRequest(input,local,{forDispatch:true}),{code:'AIIDE_LOCAL_ASSETS_NEED_PUBLIC_REFERENCE'});
 assert.throws(()=>compileAiideRequest({...input,model:'happyhorse-1.0-i2v',resolution:'720p',generateAudio:false},id=>({...assets[id],width:200})),{code:'REFERENCE_IMAGE_TOO_SMALL'});
 assert.throws(()=>compileAiideRequest({...request(model,'reference'),assets:[{assetId:'a1',role:'reference_audio'}]},id=>assets[id]),{code:'REFERENCE_REQUIRED'});
 const ref=compileAiideRequest({...request(model,'reference'),assets:[{assetId:'a',role:'reference_image'},{assetId:'v',role:'reference_video'},{assetId:'a1',role:'reference_audio'}]},id=>assets[id]);assert.deepEqual(ref.payload.metadata.content.map(c=>c.type),['image_url','video_url','audio_url']);
});
test('reference addresses cannot target local files, localhost, private IPs or credentials',()=>{
 for(const value of ['file:///tmp/a.png','http://cdn.example.com/a.png','https://127.0.0.1/a.png','https://10.0.0.1/a.png','https://[::1]/a.png','https://localhost/a.png','https://a.local/a.png','https://user:pass@cdn.example.com/a.png','https://cdn.example.com:8443/a.png'])assert.throws(()=>validateProviderReference(value));
 assert.equal(validateProviderReference('mat_12345678'),'asset://mat_12345678');
 assert.throws(()=>validateProviderReference('mat_12345678',{allowAsset:false}));
});
test('native Seedance and Happyhorse status envelopes recover the documented video URL',async()=>{
 for(const nested of [{content:{video_url:'https://cdn.example.com/render.mp4'}},{output:{video_url:'https://cdn.example.com/render.mp4'}}]){const adapter=createAiideVideoAdapter({apiKey:'dummy-no-real-key-123',networkAllowed:true,fetchImpl:async()=>Response.json({data:{status:'SUCCESS',data:{status:'succeeded',...nested}}})});assert.equal((await adapter.getStatus('task-status-001')).videoUrl,'https://cdn.example.com/render.mp4');}
});
