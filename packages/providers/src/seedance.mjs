/** Seedance 2.x local request planner. Model capabilities are conservative defaults; paid API is NOT enabled.
 * Sources: Volcengine LAS operator docs and BytePlus ModelArk tutorial (verified 2026-11-05).
 * Endpoint selection, entitlement, rates, and real request behavior require provider spike.
 */
import {createHash} from 'node:crypto';
export class SeedanceValidationError extends Error { constructor(code,message){super(message||code);this.name='SeedanceValidationError';this.code=code;this.status=422;} }
export const VIDEO_PROMPT_MAX_CHARS=4000;
const entry=(id,label,versions,options)=>Object.freeze({id,label,provider:'volcengine-las',minDuration:4,durationStep:1,supportsAutoDuration:true,...options,version:versions});
// Global visual presets. Only the official Seedance-native ratios can be submitted.
// Other frequently requested ratios remain visible as disabled UI references.
export const VISUAL_ASPECT_PRESETS=Object.freeze([
 {id:'9:16',label:'9:16 · Vertical / Shorts',native:true},
 {id:'16:9',label:'16:9 · Widescreen / YouTube',native:true},
 {id:'1:1',label:'1:1 · Square',native:true},
 {id:'4:3',label:'4:3 · Standard landscape',native:true},
 {id:'3:4',label:'3:4 · Standard portrait',native:true},
 {id:'21:9',label:'21:9 · Cinematic ultrawide',native:true},
 {id:'adaptive',label:'Auto · Follow reference / prompt',native:true},
 {id:'4:5',label:'4:5 · Social portrait (not Seedance native)',native:false},
 {id:'5:4',label:'5:4 · Classic landscape (not Seedance native)',native:false},
 {id:'3:2',label:'3:2 · Photo landscape (not Seedance native)',native:false},
 {id:'2:3',label:'2:3 · Photo portrait (not Seedance native)',native:false}
]);
export const SEEDANCE_MODELS=Object.freeze([
 entry('doubao-seedance-2-0-260128','Seedance 2.0','2.0',{maxImages:9,maxVideos:3,maxAudios:0,maxDuration:15,resolutions:['480p','720p','1080p'],ratioOptions:['16:9','4:3','1:1','3:4','9:16','21:9','adaptive'],supportsAudio:true,supportsDraft:false}),
 entry('doubao-seedance-2-0-fast-260128','Seedance 2.0 Fast','2.0-fast',{maxImages:9,maxVideos:3,maxAudios:0,maxDuration:15,resolutions:['480p','720p'],ratioOptions:['16:9','4:3','1:1','3:4','9:16','21:9','adaptive'],supportsAudio:true,supportsDraft:false}),
 entry('doubao-seedance-2-0-mini-260615','Seedance 2.0 Mini','2.0-mini',{maxImages:9,maxVideos:3,maxAudios:0,maxDuration:15,resolutions:['480p','720p'],ratioOptions:['16:9','4:3','1:1','3:4','9:16','21:9','adaptive'],supportsAudio:true,supportsDraft:false}),
 entry('doubao-seedance-2-5-260628','Seedance 2.5','2.5',{maxImages:30,maxVideos:3,maxAudios:3,maxDuration:30,resolutions:['480p','720p','1080p'],ratioOptions:['16:9','4:3','1:1','3:4','9:16','21:9','adaptive'],supportsAudio:true,supportsDraft:true})
]);
export const SEEDANCE_MODES=Object.freeze([
 {id:'text_to_video',label:'Text → Video',hint:'Prompt-only generation'},
 {id:'image_to_video',label:'Image → Video',hint:'Start from an opening frame'},
 {id:'first_last',label:'First & Last Frame',hint:'Control the beginning and ending'},
 {id:'reference',label:'Multimodal Reference',hint:'Image, motion, and optional audio refs'},
 {id:'edit',label:'Video Edit',hint:'Rework a reference video'},
 {id:'extend',label:'Video Extend',hint:'Continue a reference video'}
]);
export const SEEDANCE_FIXED_ENDPOINT='https://operator.las.ap-southeast-1.volces.com/api/v1/contents/generations/tasks';
const FAIL=(code,msg)=>{throw new SeedanceValidationError(code,msg)};
const roles={image:['first_frame','last_frame','reference_image'],video:['reference_video'],audio:['reference_audio']};
const str=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
export function seedanceCatalog(){return {status:'configuration_only',paidCallsEnabled:false,promptMaxChars:VIDEO_PROMPT_MAX_CHARS,provider:'Volcengine LAS (capabilities subject to account entitlement)',modes:SEEDANCE_MODES,models:SEEDANCE_MODELS,aspectRatioPresets:VISUAL_ASPECT_PRESETS,verifiedAsOf:'2026-11-05',sourceUrls:['https://docs.volcengine.com/docs/lake-ai-service/video-generation-enhanced-edition-basic-edition?lang=en','https://docs.byteplus.com/id/docs/modelark/video-generation-tutorial']};}
const types=new Set(['image','video','audio']);
/** assets are resolved from server-side local asset registry; never trust client supplied mime/URL */
export function compileSeedanceRequest(input,resolveAsset){
 if(!input||typeof input!=='object'||Array.isArray(input))FAIL('BAD_REQUEST','Object required');
 const model=SEEDANCE_MODELS.find(x=>x.id===input.model);if(!model)FAIL('UNSUPPORTED_MODEL','Model is not in verified capability registry');
 const mode=SEEDANCE_MODES.find(x=>x.id===input.mode);if(!mode)FAIL('UNSUPPORTED_MODE','Unsupported video mode');
 if(!str(input.prompt,VIDEO_PROMPT_MAX_CHARS))FAIL('INVALID_PROMPT',`Prompt required (1-${VIDEO_PROMPT_MAX_CHARS} chars)`);
 const promptLanguage=input.promptLanguage??'id';if(!['id','en'].includes(promptLanguage))FAIL('INVALID_PROMPT_LANGUAGE','Prompt language must be ID or EN');
 const resolution=input.resolution??'720p';if(!model.resolutions.includes(resolution))FAIL('UNSUPPORTED_RESOLUTION',`${model.label} does not support ${resolution} here`);
 const ratio=input.ratio??'9:16';if(!model.ratioOptions.includes(ratio))FAIL('INVALID_RATIO','Unsupported ratio');
 const duration=input.duration??5;
 if(!Number.isInteger(duration)||!(duration===-1&&model.supportsAutoDuration) && (duration<model.minDuration||duration>model.maxDuration||(duration-model.minDuration)%model.durationStep!==0))
   FAIL('INVALID_DURATION',`Duration must be ${model.minDuration}..${model.maxDuration}s in ${model.durationStep}s increments (or automatic)`);
 if(input.generateAudio!==undefined&&typeof input.generateAudio!=='boolean')FAIL('INVALID_AUDIO_FLAG','generateAudio must be boolean');
 if(input.watermark!==undefined&&typeof input.watermark!=='boolean')FAIL('INVALID_WATERMARK','watermark must be boolean');
 if(input.draft!==undefined&&typeof input.draft!=='boolean')FAIL('INVALID_DRAFT','draft must be boolean');
 if(input.draft && !model.supportsDraft)FAIL('DRAFT_UNSUPPORTED','Draft mode is model-specific');
 if(input.draft && resolution!=='480p')FAIL('DRAFT_RESOLUTION','Draft preview must use 480p');
 if(input.seed!==undefined && (!Number.isSafeInteger(input.seed)||input.seed<0||input.seed>4294967295))FAIL('INVALID_SEED','Seed out of range');
 const refs=input.assets??[];if(!Array.isArray(refs)||refs.length>40)FAIL('INVALID_ASSETS','Maximum 40 attached references');
 const content=[{type:'text',text:input.prompt.trim()}],seen=new Set(),count={image:0,video:0,audio:0},roleCount={};
 for(const ref of refs){
  if(!ref||typeof ref!=='object'||!str(ref.assetId,80)||!str(ref.role,40))FAIL('INVALID_ASSETS','Asset id/role required');
  if(seen.has(ref.assetId))FAIL('DUPLICATE_ASSET','Same asset cannot be attached twice');seen.add(ref.assetId);
  const asset=resolveAsset?.(ref.assetId);if(!asset||!types.has(asset.kind))FAIL('ASSET_NOT_FOUND','Attachment must exist in local asset library');
  if(!roles[asset.kind].includes(ref.role))FAIL('ASSET_ROLE_MISMATCH',`Role ${ref.role} cannot use ${asset.kind}`);
  count[asset.kind]++;roleCount[ref.role]=(roleCount[ref.role]||0)+1;
  if(roleCount[ref.role]>1&&['first_frame','last_frame'].includes(ref.role))FAIL('DUPLICATE_FRAME','Only one first and last frame allowed');
  content.push({type:asset.kind==='image'?'image_url':asset.kind==='video'?'video_url':'audio_url',role:ref.role,[asset.kind+'_url']:{url:`LOCAL_ASSET_NOT_STAGED:${asset.id}`}});
 }
 if(count.image>model.maxImages||count.video>model.maxVideos||count.audio>model.maxAudios)FAIL('REF_LIMIT',`Reference count exceeds conservative ${model.label} limit`);
 if(mode.id==='text_to_video' && refs.length)FAIL('UNEXPECTED_REFERENCES','Text-to-video has no references');
 if(mode.id==='image_to_video' && (count.image!==1||refs.length!==1||roleCount.first_frame!==1))FAIL('FIRST_FRAME_REQUIRED','Exactly one first frame required');
 if(mode.id==='first_last' && (refs.length!==2||roleCount.first_frame!==1||roleCount.last_frame!==1))FAIL('FIRST_LAST_REQUIRED','Exactly one first and one last frame required');
 if(mode.id==='reference'&&!refs.length)FAIL('REFERENCE_REQUIRED','Attach at least one reference');
 if(['edit','extend'].includes(mode.id)&&count.video<1)FAIL('REFERENCE_VIDEO_REQUIRED','Edit/extend requires a video reference');
 if(count.audio&&!count.image&&!count.video&&mode.id==='reference')FAIL('AUDIO_ALONE_UNSUPPORTED','Audio alone cannot be used as a reference');
 if(model.version==='2.5' && ['edit','extend','image_to_video','first_last'].includes(mode.id)){
  if(ratio!=='adaptive')FAIL('ADAPTIVE_RATIO_REQUIRED','This mode requires adaptive aspect ratio');
 }
 if(model.version==='2.5'&&['edit','extend'].includes(mode.id)&&duration!==-1)FAIL('AUTO_DURATION_REQUIRED','Seedance 2.5 edit/extend requires automatic duration');
 if(resolution==='1080p' && (count.image||count.video||count.audio))FAIL('REFERENCE_1080P_UNVERIFIED','1080p with reference inputs disabled until provider entitlement test');
 const payload={model:model.id,content,resolution,ratio,duration,generate_audio:input.generateAudio??true,watermark:input.watermark??false};
 if(input.seed!==undefined)payload.seed=input.seed;
 if(input.draft)payload.draft=true;
 if(mode.id==='reference')payload.omni_reference_task_type='reference';
 if(mode.id==='edit')payload.omni_reference_task_type='edit';
 if(mode.id==='extend')payload.omni_reference_task_type='extend';
 const warnings=[...new Set([...(refs.length?['LOCAL_ASSETS_REQUIRE_SIGNED_STAGING']:[]),'PROVIDER_CAPABILITY_AND_PRICE_UNVERIFIED','NO_BILLABLE_SUBMISSION'])];
 const requestHash=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
 return {model:model.id,mode:mode.id,promptLanguage,requestHash,status:'prepared_local',dispatchable:false,paidCallsEnabled:false,attachmentCount:refs.length,payload,endpoint:SEEDANCE_FIXED_ENDPOINT,warnings};
}
