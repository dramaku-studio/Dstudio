import test from 'node:test';import assert from 'node:assert/strict';
import {compileSeedanceRequest,seedanceCatalog,SEEDANCE_MODELS} from '../src/seedance.mjs';
const catalog=seedanceCatalog(),base={model:SEEDANCE_MODELS[0].id,mode:'text_to_video',prompt:'A dramatic tracking shot',duration:5,ratio:'9:16',resolution:'720p'};
const db=new Map([['img1',{id:'img1',kind:'image'}],['img2',{id:'img2',kind:'image'}],['vid1',{id:'vid1',kind:'video'}],['aud1',{id:'aud1',kind:'audio'}]]);const resolve=id=>db.get(id);
const make=x=>compileSeedanceRequest({...base,...x},resolve);
function rejects(x,code){assert.throws(()=>make(x),e=>e.code===code,code)}
test('catalog includes 2.0 tiers and 2.5 with no paid calls',()=>{assert.equal(catalog.models.length,4);assert.equal(catalog.paidCallsEnabled,false)});
test('T2V yields official-shaped payload preview but no submission',()=>{const p=make({});assert.equal(p.payload.content[0].type,'text');assert.equal(p.dispatchable,false);assert.match(p.requestHash,/^[0-9a-f]{64}$/)});
test('image-to-video first frame requires role and asset',()=>{rejects({mode:'image_to_video'},'FIRST_FRAME_REQUIRED');const p=make({mode:'image_to_video',assets:[{assetId:'img1',role:'first_frame'}]});assert.equal(p.payload.content[1].role,'first_frame');assert.match(p.warnings.join(),/STAGING/) });
test('first & last frames and reference mode compile',()=>{assert.equal(make({mode:'first_last',assets:[{assetId:'img1',role:'first_frame'},{assetId:'img2',role:'last_frame'}]}).attachmentCount,2);assert.equal(make({mode:'reference',assets:[{assetId:'vid1',role:'reference_video'}]}).payload.omni_reference_task_type,'reference')});
test('unknown models, invalid settings, wrong media role rejected server-side',()=>{rejects({model:'seedance-fake'},'UNSUPPORTED_MODEL');rejects({duration:99},'INVALID_DURATION');rejects({resolution:'4k'},'UNSUPPORTED_RESOLUTION');rejects({mode:'reference',assets:[{assetId:'img1',role:'reference_video'}]},'ASSET_ROLE_MISMATCH');rejects({mode:'reference',assets:[{assetId:'fake',role:'reference_image'}]},'ASSET_NOT_FOUND')});
test('audio refs unavailable for 2.0 conservative profile',()=>rejects({mode:'reference',assets:[{assetId:'aud1',role:'reference_audio'}]},'REF_LIMIT'));
test('2.5 draft and adaptive ratio constraints are enforced',()=>{const model=SEEDANCE_MODELS[3].id;rejects({model,draft:true},'DRAFT_RESOLUTION');const p=make({model,draft:true,resolution:'480p'});assert.equal(p.payload.draft,true);rejects({model,mode:'image_to_video',assets:[{assetId:'img1',role:'first_frame'}]},'ADAPTIVE_RATIO_REQUIRED')});
test('edit, extend, and reference combination validated',()=>{rejects({mode:'extend'},'REFERENCE_VIDEO_REQUIRED');assert.equal(make({mode:'extend',ratio:'adaptive',assets:[{assetId:'vid1',role:'reference_video'}]}).mode,'extend');rejects({mode:'reference',assets:[{assetId:'aud1',role:'reference_audio'}],model:SEEDANCE_MODELS[3].id},'AUDIO_ALONE_UNSUPPORTED')});

test('2.5 edit auto duration is accepted with adaptive ratio only',()=>{const model=SEEDANCE_MODELS[3].id;rejects({model,mode:'edit',ratio:'adaptive',duration:5,assets:[{assetId:'vid1',role:'reference_video'}]},'AUTO_DURATION_REQUIRED');const p=make({model,mode:'edit',ratio:'adaptive',duration:-1,assets:[{assetId:'vid1',role:'reference_video'}]});assert.equal(p.payload.duration,-1);assert.equal(p.payload.omni_reference_task_type,'edit');});


test('CP010: all native aspect ratio presets accepted and common non-native formats blocked',()=>{
 const supported=['9:16','16:9','1:1','4:3','3:4','21:9','adaptive'];
 assert.deepEqual(catalog.aspectRatioPresets.filter(x=>x.native).map(x=>x.id),supported);
 for(const ratio of supported)assert.equal(make({ratio}).payload.ratio,ratio);
 for(const ratio of ['4:5','5:4','3:2','2:3'])rejects({ratio},'INVALID_RATIO');
});
test('CP010: every supported whole-second duration is valid per Seedance model, fractional and out-of-range are blocked',()=>{
 for(const model of SEEDANCE_MODELS){
  assert.equal(model.durationStep,1);
  for(let n=model.minDuration;n<=model.maxDuration;n++)assert.equal(make({model:model.id,duration:n}).payload.duration,n);
  for(const n of [0,1,2,3,4.5,model.maxDuration+1,NaN])rejects({model:model.id,duration:n},'INVALID_DURATION');
  assert.equal(make({model:model.id,duration:-1}).payload.duration,-1);
 }
});
test('CP010: Seedance 2.5 special ratio and duration constraints remain enforced',()=>{
 const model=SEEDANCE_MODELS[3].id;
 rejects({model,mode:'first_last',ratio:'9:16',assets:[{assetId:'img1',role:'first_frame'},{assetId:'img2',role:'last_frame'}]},'ADAPTIVE_RATIO_REQUIRED');
 const p=make({model,mode:'first_last',ratio:'adaptive',duration:30,assets:[{assetId:'img1',role:'first_frame'},{assetId:'img2',role:'last_frame'}]});
 assert.equal(p.payload.duration,30);
});
test('CP010: 2.0 edit / extend may use supported explicit ratio (2.5 differs)',()=>{
 const p=make({mode:'edit',ratio:'16:9',duration:6,assets:[{assetId:'vid1',role:'reference_video'}]});
 assert.equal(p.payload.ratio,'16:9');
});

test('CP012: prompt language ID/EN is validated as metadata without inventing provider arguments',()=>{
 const id=make({promptLanguage:'id'}),en=make({promptLanguage:'en'});
 assert.equal(id.promptLanguage,'id');assert.equal(en.promptLanguage,'en');
 assert.equal(id.payload.content[0].text,en.payload.content[0].text);
 assert.equal('prompt_language' in en.payload,false);
 rejects({promptLanguage:'de'},'INVALID_PROMPT_LANGUAGE');
});
