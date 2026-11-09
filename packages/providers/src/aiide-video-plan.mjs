/** AIIDE contract registry. Documentation-backed planning; never makes a network request.
 * Defaults and caps are deliberately narrower than upstream accounts may support.
 * Public docs: https://aiide.apifox.cn/english/llms.txt (checked 2026-11-08).
 */
import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
export const AIIDE_ORIGIN='https://www.aiide.com';
export const AIIDE_MODEL_ORIGIN='https://api.aiide.com';
export const AIIDE_MODES=Object.freeze([
 {id:'text_to_video',label:'Text → Video'},
 {id:'image_to_video',label:'Image → Video'},
 {id:'first_last',label:'First & Last Frame'},
 {id:'reference',label:'Multimodal Reference'},
 {id:'edit',label:'Video Edit'},
 {id:'extend',label:'Video Extend — belum didokumentasikan AIIDE',disabled:true}
]);
const ratios=['16:9','9:16','1:1','4:3','3:4'];
const entry=(id,label,family,modes,extra={})=>Object.freeze({id,label,family,modes,provider:'aiide',minDuration:3,maxDuration:15,durationStep:1,supportsAutoDuration:false,resolutions:['720p','1080p'],ratioOptions:ratios,maxImages:0,maxVideos:0,maxAudios:0,supportsAudio:false,supportsWatermark:true,supportsSeed:false,supportsDraft:false,...extra});
export const AIIDE_MODELS=Object.freeze([
 // Exact model IDs and metadata fields from AIIDE Model Plaza examples, 2026-11-09.
 // Keep non-Mini duration/resolution at the documented example until broader limits are verified.
 ...[
  ['dreamina-seedance-2-0-fast-hc','Dreamina Seedance 2.0 Fast'],
  ['dreamina-seedance-2-0-hc','Dreamina Seedance 2.0'],
  ['dreamina-seedance-2-0-mini-hc','Dreamina Seedance 2.0 Mini'],
  ['dreamina-seedance-2-5-hc','Dreamina Seedance 2.5'],
  ['doubao-seedance-2-0-mini-260615','Doubao Seedance 2.0 Mini'],
  ['doubao-seedance-2-5-260628','Doubao Seedance 2.5']
 ].map(([id,label])=>entry(id,label,'seedance',['text_to_video','image_to_video','first_last','reference'],{
  origin:AIIDE_MODEL_ORIGIN,minDuration:id.includes('mini')?4:5,maxDuration:id.includes('mini')?15:5,
  resolutions:id.includes('mini')?['480p','720p']:['480p'],maxImages:9,maxVideos:3,maxAudios:3,
  supportsAudio:true,ratioOptions:[...ratios,'21:9'],sources:['464722026e0','9241613m0'],
  documentationUrls:[`https://www.aiide.com/en/pricing/${id}`],
  note:'Profil dari contoh resmi AIIDE Model Plaza. Batas lokal konservatif; hasil generate nyata belum diuji.'
 })),
 ...['','-fast'].map(s=>entry(`doubao-seedance-2-0${s}-260128`,`Seedance 2.0${s?' Fast':''}`,'seedance',['text_to_video','image_to_video','first_last','reference'],{minDuration:4,maxImages:9,maxVideos:3,maxAudios:3,supportsAudio:true,resolutions:['provider_default'],ratioOptions:[...ratios,'21:9'],sources:['464722026e0','9241613m0'],note:'Resolusi mengikuti provider. Frame awal/akhir memakai metadata yang didokumentasikan AIIDE. Batas lokal konservatif; belum diuji berbayar.'})),
 entry('happyhorse-1.0-t2v','Happyhorse · Teks','happyhorse',['text_to_video'],{sources:['464722017e0']}),
 entry('happyhorse-1.0-i2v','Happyhorse · Gambar awal','happyhorse',['image_to_video'],{maxImages:1,sources:['464722018e0']}),
 entry('happyhorse-1.0-r2v','Happyhorse · Referensi gambar','happyhorse',['reference'],{maxImages:9,sources:['464722019e0']}),
 entry('happyhorse-1.0-video-edit','Happyhorse · Edit video','happyhorse',['edit'],{minDuration:-1,maxDuration:-1,supportsAutoDuration:true,maxImages:5,maxVideos:1,sources:['464722020e0'],note:'Durasi mengikuti video sumber, maksimal 15 detik keluaran. Provider menghitung video masukan dan keluaran.'}),
 ...['fast','pro'].map(s=>entry(`sora-v3-${s}`,`Seed-2.0 · Sora-format ${s}`,'sora',['text_to_video','reference'],{minDuration:5,resolutions:['480p','720p'],maxImages:4,maxVideos:3,ratioOptions:[...ratios,'21:9'],supportsWatermark:false,sources:['464722031e0','464722032e0'],note:'Nama model pada endpoint AIIDE adalah sora-v3; keluarga di dokumentasi AIIDE: Seed-2.0 Special Price.'})),
 ...[false,true].flatMap(ref=>[4,6,8].map(n=>entry(`gemini-veo-3.1-generate-preview${ref?'-ref':''}-${n}s`,`Veo 3.1${ref?' Reference':''} · ${n}s`,'veo',['text_to_video','reference'],{minDuration:n,maxDuration:n,maxImages:ref?3:2,ratioOptions:['16:9','9:16'],supportsWatermark:false,sources:['464722028e0','464722029e0']})))
]);
export function aiideVideoCatalog(){return {provider:'aiide',status:'local_contract_test',paidCallsEnabled:false,liveVerified:false,verifiedAsOf:'2026-11-08',promptMaxChars:4000,models:AIIDE_MODELS,modes:AIIDE_MODES,aspectRatioPresets:[...ratios,'21:9'].map(id=>({id,label:id,native:true})),sourceUrls:['https://aiide.apifox.cn/english/llms.txt'],unsupportedReason:'Video Extend belum memiliki kontrak AIIDE terverifikasi. Edit/Extend 2.5 belum diaktifkan karena contoh payload khusus belum diverifikasi.'};}
const bad=(code)=>{throw Object.assign(new Error(code),{code,status:422});};
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Store references only; never fetch a client-supplied URL. */
export function validateProviderReference(value,{allowAsset=true}={}){
 if(typeof value!=='string'||value.length>2048)bad('AIIDE_REFERENCE_INVALID');
 const v=value.trim();
 if(allowAsset&&/^(?:asset:\/\/)?mat_[A-Za-z0-9_-]{6,160}$/.test(v))return 'asset://'+v.replace(/^asset:\/\//,'');
 let u;try{u=new URL(v);}catch{bad('AIIDE_REFERENCE_INVALID');}
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash||isIP(u.hostname)||!u.hostname.includes('.')||/(?:^|\.)(localhost|local|internal|test|invalid)$/.test(u.hostname)||u.hostname==='metadata.google.internal'||!/^\/[\w%/.,~+@!$&'()*;=:-]+$/i.test(u.pathname))bad('AIIDE_REFERENCE_PUBLIC_HTTPS_REQUIRED');
 return u.href;
}
export function compileAiideRequest(input,resolveAsset=()=>null,{forDispatch=false,mockReferences=false}={}){
 if(!input||typeof input!=='object'||Array.isArray(input))bad('AIIDE_INPUT_INVALID');
 const model=AIIDE_MODELS.find(m=>m.id===input.model);if(!model)bad('AIIDE_MODEL_NOT_DOCUMENTED');
 if(!model.modes.includes(input.mode))bad('AIIDE_MODE_NOT_SUPPORTED');
 if(typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>4000)bad('INVALID_PROMPT');
 const language=input.promptLanguage??'id';if(!['id','en'].includes(language))bad('INVALID_PROMPT_LANGUAGE');
 const resolution=input.resolution??model.resolutions[0],ratio=input.ratio??model.ratioOptions[0],duration=input.duration??(model.minDuration===-1?-1:Math.max(model.minDuration,5));
 if(!model.resolutions.includes(resolution))bad('UNSUPPORTED_RESOLUTION');
 if(!model.ratioOptions.includes(ratio))bad('INVALID_RATIO');
 if(!Number.isInteger(duration)||duration<model.minDuration||duration>model.maxDuration)bad('INVALID_DURATION');
 for(const flag of ['generateAudio','watermark','draft'])if(input[flag]!==undefined&&typeof input[flag]!=='boolean')bad('AIIDE_FLAG_INVALID');
 if(input.draft)bad('AIIDE_DRAFT_FLAG_UNSUPPORTED');
 if(input.seed!==undefined)bad('AIIDE_SEED_NOT_DOCUMENTED');
 if(input.generateAudio&&!model.supportsAudio)bad('AIIDE_AUDIO_CONTROL_UNSUPPORTED');
 if(input.watermark&&!model.supportsWatermark)bad('AIIDE_WATERMARK_CONTROL_UNSUPPORTED');
 const refs=input.assets??[];if(!Array.isArray(refs)||refs.length>15)bad('INVALID_ASSETS');
 const seen=new Set(),counts={image:0,video:0,audio:0},roles={},missing=[],resolved=[];
 for(const ref of refs){
  if(!ref||seen.has(ref.assetId))bad('DUPLICATE_ASSET');seen.add(ref.assetId);
  const a=resolveAsset(ref.assetId);if(!a)bad('ASSET_NOT_FOUND');
  const allowed={image:['first_frame','last_frame','reference_image'],video:['reference_video'],audio:['reference_audio']}[a.kind];
  if(!allowed?.includes(ref.role))bad('ASSET_ROLE_MISMATCH');
  counts[a.kind]++;roles[ref.role]=(roles[ref.role]||0)+1;
  let url=a.providerReference||null;
  if(url)url=validateProviderReference(url,{allowAsset:model.family==='seedance'});
  if(!url){missing.push(a.id);url=mockReferences?`https://contract-fixture.example/${a.id}.${a.kind==='image'?'png':a.kind==='video'?'mp4':'mp3'}`:`LOCAL_ASSET_NOT_STAGED:${a.id}`;}
  if(a.width&&a.height){
   const short=Math.min(a.width,a.height),long=Math.max(a.width,a.height),ar=a.width/a.height;
   if(a.kind==='image'&&model.family==='happyhorse'&&short<(input.mode==='reference'?400:300))bad('REFERENCE_IMAGE_TOO_SMALL');
   if(a.kind==='video'&&input.mode==='edit'&&(short<320||long>2160||ar<0.4||ar>2.5||a.fps<=8))bad('REFERENCE_VIDEO_DIMENSIONS');
   if(model.family==='sora'&&(short<300||long>6000||ar<0.4||ar>2.5))bad('REFERENCE_DIMENSIONS');
  }
  if(a.kind==='video'&&a.durationSeconds){
   if(input.mode==='edit'&&(a.durationSeconds<3||a.durationSeconds>60))bad('REFERENCE_VIDEO_DURATION');
   if(['sora','seedance'].includes(model.family)&&(a.durationSeconds<2||a.durationSeconds>15))bad('REFERENCE_VIDEO_DURATION');
  }
  resolved.push({assetId:a.id,role:ref.role,kind:a.kind,url,sha256:a.sha256,durationSeconds:a.durationSeconds||0});
 }
 if(counts.image>model.maxImages||counts.video>model.maxVideos||counts.audio>model.maxAudios)bad('REF_LIMIT');
 if(input.mode==='text_to_video'&&refs.length)bad('UNEXPECTED_REFERENCES');
 if(input.mode==='image_to_video'&&(refs.length!==1||roles.first_frame!==1))bad('FIRST_FRAME_REQUIRED');
 if(input.mode==='first_last'&&(refs.length!==2||roles.first_frame!==1||roles.last_frame!==1))bad('FIRST_LAST_REQUIRED');
 if(input.mode==='reference'&&(!refs.length||roles.first_frame||roles.last_frame||(!counts.image&&!counts.video)))bad('REFERENCE_REQUIRED');
 if(input.mode==='edit'&&(counts.video!==1||roles.first_frame||roles.last_frame))bad('REFERENCE_VIDEO_REQUIRED');
 if(['sora','seedance'].includes(model.family)&&resolved.filter(a=>a.kind==='video').reduce((s,a)=>s+a.durationSeconds,0)>15.01)bad('REFERENCE_VIDEO_TOTAL_DURATION');
 if(forDispatch&&missing.length)bad('AIIDE_LOCAL_ASSETS_NEED_PUBLIC_REFERENCE');
 const prompt=input.prompt.trim(),byRole=r=>resolved.filter(a=>a.role===r).map(a=>a.url);
 let payload={model:model.id,prompt},path='/v1/video/generations';
 if(model.family==='seedance'){
  const content=resolved.filter(a=>a.role.startsWith('reference_')).map(a=>({type:a.kind+'_url',[a.kind+'_url']:{url:a.url},role:a.role}));
  payload.metadata={...(resolution==='provider_default'?{}:{resolution}),content,generate_audio:input.generateAudio??true,ratio,duration,watermark:input.watermark??false};
  if(roles.first_frame)payload.metadata.first_frame_image=byRole('first_frame')[0];
  if(roles.last_frame)payload.metadata.last_frame_image=byRole('last_frame')[0];
 }else if(model.family==='happyhorse'){
  payload.metadata={parameters:{ratio,resolution:resolution.toUpperCase(),watermark:input.watermark??false,...(input.mode==='edit'?{}:{duration})}};
  if(input.mode==='image_to_video')payload.input_reference=byRole('first_frame')[0];
  if(input.mode==='edit')payload.input_reference=byRole('reference_video')[0];
  if(['reference','edit'].includes(input.mode))payload.images=byRole('reference_image');
 }else if(model.family==='sora'){
  path='/v1/videos';payload.seconds=String(duration);payload.video_config={aspect_ratio:ratio,resolution_name:resolution};
  if(refs.length){payload.reference_images=byRole('reference_image');payload.reference_videos=byRole('reference_video');}
 }else{
  path='/v1/videos';payload.size=resolution==='1080p'?(ratio==='16:9'?'1920x1080':'1080x1920'):(ratio==='16:9'?'1280x720':'720x1280');
  if(refs.length)payload.images=byRole('reference_image');
 }
 const normalizedInput={provider:'aiide',model:model.id,mode:input.mode,prompt,promptLanguage:language,ratio,resolution,duration,generateAudio:model.supportsAudio?(input.generateAudio??true):false,watermark:model.supportsWatermark?(input.watermark??false):false,draft:false,assets:refs.map(r=>({assetId:r.assetId,role:r.role}))};
 const contract='aiide-public-2026-11-08';
 return {provider:'aiide',contract,model:model.id,mode:input.mode,input:normalizedInput,endpoint:(model.origin||AIIDE_ORIGIN)+path,payload,requestHash:sha({contract,payload,assets:resolved.map(a=>({id:a.assetId,sha:a.sha256}))}),attachmentCount:refs.length,missingReferences:missing,status:missing.length?'prepared_local_needs_reference':'prepared_local',dispatchable:false,paidCallsEnabled:false,liveVerified:false,warnings:[...(missing.length?['LOCAL_ASSETS_NEED_PUBLIC_REFERENCE']:[]),'PAID_GENERATION_OFF','LIVE_ACCOUNT_UNVERIFIED'],sourceUrls:[...(model.documentationUrls||[]),...model.sources.map(id=>`https://aiide.apifox.cn/english/${id}`)]};
}
