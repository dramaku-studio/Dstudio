import {teamPassword,validTeamPassword} from './team-password.mjs';
/** Dramasaku local operator console. Loopback-only; paid video/TTS requires explicit opt-in. */
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes,timingSafeEqual,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname,join,resolve} from 'node:path';
import {createEncryptedVault} from '../../packages/security/src/vault.mjs';
import {createEncryptedKeyPools} from '../../packages/security/src/key-pools.mjs';
import {createOfflineDemo} from './demo-engine.mjs';
import {createWorkspaceStore,portableHash} from './workspace.mjs';
import {seedanceCatalog,compileSeedanceRequest} from '../../packages/providers/src/seedance.mjs';
import {createSeedanceLocalStore} from '../../packages/media/src/seedance-local-store.mjs';
import {createLocalLiveEngine} from './local-live.mjs';
import {createAiideVideoEngine} from './aiide-video.mjs';
import {createLocalTtsEngine} from './tts-engine.mjs';
import {createAiideActivation} from './aiide-activation.mjs';
import {keyOnboardingInput} from './key-onboarding.mjs';
import {createProviderConnectionTester} from './provider-connection.mjs';
import {aiideVideoCatalog,compileAiideRequest} from '../../packages/providers/src/aiide-video-plan.mjs';
import {testAiideLocally} from './aiide-local-test.mjs';
import {createProductionStore} from './production.mjs';
import {createProjectPackages} from './project-package.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const dir=dirname(fileURLToPath(import.meta.url));
export function createLocalConsole({host='127.0.0.1',port=4184,teamLogin=false,adminToken=process.env.DRAMASAKU_LOCAL_ADMIN_TOKEN,vaultKey=process.env.DRAMASAKU_VAULT_KEY_B64,vaultFile=process.env.DRAMASAKU_VAULT_FILE||resolve(dir,'../../.local-private/credentials.enc.json'),demo=null,assetRoot,liveEnabled=false,capabilityVerified=false,liveFetchImpl=fetch,aiideAutoActivate=false,aiideVideoEnabled=false,aiideVideoCapabilityVerified=false,aiideReadOnlyEnabled=false,aiideVideoFetchImpl=fetch,aiideMediaHosts=[],ttsEnabled=false,ttsCapabilityVerified=false,aiideTtsCapabilityVerified=false,ttsFetchImpl=fetch,keyTestFetchImpl=fetch}={}){
 if(!['127.0.0.1','::1'].includes(host))throw Error('Local operator console refuses public bind');
 if(typeof adminToken!=='string'||adminToken.length<20)throw Error('Set DRAMASAKU_LOCAL_ADMIN_TOKEN (20+ chars); not committed to repository');
 const password=teamLogin?teamPassword(join(dirname(vaultFile),'team-password.json')):null;
 const vault=createEncryptedVault({file:vaultFile,key:vaultKey});
 const keyPools=createEncryptedKeyPools({file:resolve(dirname(vaultFile),'key-pools.enc.json'),key:vaultKey});
 const activation=aiideAutoActivate?createAiideActivation({keyPools,fetchImpl:keyTestFetchImpl}):null;
 const keyConnection=createProviderConnectionTester({keyPools,fetchImpl:keyTestFetchImpl});
 const seedance=createSeedanceLocalStore({root:assetRoot||resolve(dirname(vaultFile),'seedance-assets')});
 const workspace=createWorkspaceStore({file:resolve(dirname(vaultFile),'creative-workspace.json')});
 const live=createLocalLiveEngine({root:resolve(dirname(vaultFile),'live-video'),loadApiKey:()=>vault.getForServerOnly('volcengine_las'),fetchImpl:liveFetchImpl,enabled:liveEnabled,capabilityVerified,maxDaily:1});
 const aiideVideo=createAiideVideoEngine({root:resolve(dirname(vaultFile),'aiide-video'),keyPool:keyPools,activation,fetchImpl:aiideVideoFetchImpl,enabled:aiideVideoEnabled,capabilityVerified:aiideVideoCapabilityVerified,readOnlyEnabled:aiideReadOnlyEnabled,allowedMediaHosts:aiideMediaHosts,resolveAsset:id=>seedance.resolveAsset(id),maxDaily:1});
 const tts=createLocalTtsEngine({root:resolve(dirname(vaultFile),'tts-audio'),loadApiKey:slot=>vault.getForServerOnly(slot),fetchImpl:ttsFetchImpl,enabled:ttsEnabled,capabilityVerified:ttsCapabilityVerified,aiideCapabilityVerified:aiideTtsCapabilityVerified,maxDaily:1});
 const production=createProductionStore({root:resolve(dirname(vaultFile),'production'),workspace,assets:seedance});
 const packages=createProjectPackages({root:dirname(vaultFile),workspace,assets:seedance,production,tts});
 let edits=Promise.resolve();const edit=fn=>{const p=edits.then(fn);edits=p.catch(()=>{});return p;};
 const currentProject=async()=>(await workspace.read())?.projectId||null;
 const inspectInput=async input=>{for(const ref of input?.assets||[])await seedance.inspectAsset(ref.assetId);return input;};
 const localTools=()=>Promise.all(['ffmpeg','ffprobe'].map(async command=>{
  try{
   const args=command==='ffmpeg'?['-hide_banner','-encoders']:['-version'];
   const {stdout}=await promisify(execFile)(command,args,{timeout:5000,maxBuffer:200000});
   if(command==='ffmpeg'){
    const missing=['libx264','aac'].filter(codec=>!stdout.split('\n').some(line=>line.trim().split(/\s+/)[1]===codec));
    if(missing.length)return {name:command,available:false,detail:'FFmpeg dengan encoder '+missing.join(', ')};
   }
   return {name:command,available:true};
  }catch{return {name:command,available:false};}
 }));
 demo??=createOfflineDemo({getCreativeInput:async()=>(await workspace.read())?.workspace?.input});
 const sessions=new Map(),failed=new Map();const originSet=new Set([`http://127.0.0.1:${port}`,`http://localhost:${port}`,`http://[::1]:${port}`]);
 const denyKey=(a,b)=>{const h1=createHash('sha256').update(String(a)).digest(),h2=createHash('sha256').update(String(b)).digest();return !timingSafeEqual(h1,h2);};
 function session(req){const cookie=req.headers.cookie||'';const m=/(?:^|;\s*)ds_session=([a-f0-9]{64})(?:;|$)/.exec(cookie);if(!m)return null;const s=sessions.get(m[1]);if(!s)return null;if(s.expires<Date.now()){sessions.delete(m[1]);return null;}return s;}
 const security={ 'cache-control':'no-store, max-age=0','x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer','permissions-policy':'camera=(), microphone=(), geolocation=()', 'content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; media-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"};
 const server=http.createServer(async(req,res)=>{
  const send=(status,payload,extra={})=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8',...security,...extra});res.end(JSON.stringify(payload));};
  const fail=(status,code)=>send(status,{error:code});
  try{
   const u=new URL(req.url,'http://localhost');const p=u.pathname;
   const hostHeader=req.headers.host??'';if(!originSet.has(`http://${hostHeader}`))return fail(403,'HOST_DENIED');
   if(req.method!=='GET'&&req.method!=='HEAD'){
     if(!req.headers.origin||!originSet.has(req.headers.origin)||!['same-origin','none',undefined].includes(req.headers['sec-fetch-site']))return fail(403,'ORIGIN_DENIED');
   }
   const readBinary=async()=>{
     if(req.headers['content-type']!=='application/octet-stream')throw Object.assign(Error('BAD_CONTENT_TYPE'),{status:415});
     const contentLength=Number(req.headers['content-length']||0);if(contentLength>20*1024*1024)throw Object.assign(Error('ASSET_TOO_LARGE'),{status:413});
     const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.byteLength;if(bytes>20*1024*1024)throw Object.assign(Error('ASSET_TOO_LARGE'),{status:413});chunks.push(chunk);}
     return Buffer.concat(chunks);
   };
   const readJson=async(maxBytes=12_000)=>{
     if(!req.headers['content-type']?.startsWith('application/json'))throw Object.assign(Error('BAD_CONTENT_TYPE'),{status:415});
     const arr=[];let size=0;for await(const c of req){size+=c.length;if(size>maxBytes)throw Object.assign(Error('BODY_TOO_LARGE'),{status:413});arr.push(c);}
     try {return JSON.parse(Buffer.concat(arr).toString('utf8'));}catch{throw Object.assign(Error('BAD_JSON'),{status:400});}
   };
   if(req.method==='GET'&&p==='/'){res.writeHead(200,{'content-type':'text/html; charset=utf-8',...security});res.end(await readFile(join(dir,'ui.html')));return;}
   if(req.method==='GET'&&p==='/dramasaku-logo.png'){res.writeHead(200,{'content-type':'image/png',...security});res.end(await readFile(resolve(dir,'../web/public/dramasaku-logo.png')));return;}
   if(req.method==='GET'&&p==='/app.css'){res.writeHead(200,{'content-type':'text/css; charset=utf-8',...security});res.end(await readFile(join(dir,'app.css')));return;}
   if(req.method==='GET'&&p==='/i18n.js'){res.writeHead(200,{'content-type':'text/javascript; charset=utf-8',...security});res.end(await readFile(join(dir,'i18n.js')));return;}
   if(req.method==='GET'&&p==='/internal.js'){res.writeHead(200,{'content-type':'text/javascript; charset=utf-8',...security});res.end(await readFile(join(dir,'internal.js')));return;}
   if(req.method==='GET'&&p==='/app.js'){res.writeHead(200,{'content-type':'text/javascript; charset=utf-8',...security});res.end(await readFile(join(dir,'app.js')));return;}
   if(req.method==='GET'&&p==='/api/health')return send(200,{ok:true,mode:'local_operator',production:false,paidCallsEnabled:(liveEnabled&&capabilityVerified)||(activation?(await activation.status({cachedOnly:true})).ready:(aiideVideoEnabled&&aiideVideoCapabilityVerified))||(ttsEnabled&&(ttsCapabilityVerified||aiideTtsCapabilityVerified))});
   const s=session(req);
   if(req.method==='GET'&&p==='/api/session')return send(200,{authenticated:!!s,csrf:s?.csrf??null,offlineOnly:!aiideAutoActivate&&!aiideVideoEnabled&&!liveEnabled&&!ttsEnabled});
   if(req.method==='POST'&&p==='/api/login'){
     const body=await readJson();
     return await edit(async()=>{
     const a=failed.get('local')??{count:0,until:0};if(a.count>=5&&a.until>Date.now())return fail(429,'RATE_LIMITED');
     if(typeof body?.token!=='string'||(password?!await password.verify(body.token):denyKey(body.token,adminToken))){
       failed.set('local',{count:a.count+1,until:Date.now()+5*60_000});return fail(401,'INVALID_CREDENTIALS');
     }
     failed.delete('local');const sid=randomBytes(32).toString('hex');const csrf=randomBytes(24).toString('hex');sessions.set(sid,{csrf,expires:Date.now()+60*60*1000});
     return send(200,{authenticated:true,csrf},{'set-cookie':`ds_session=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`});
     });
   }
   if(!s)return fail(401,'AUTH_REQUIRED');
   if(req.method==='POST'||req.method==='DELETE'){
     if(!req.headers['x-dramasaku-csrf']||denyKey(req.headers['x-dramasaku-csrf'],s.csrf))return fail(403,'CSRF_DENIED');
   }
   if(req.method==='POST'&&p==='/api/team/password'){
     if(!password)return fail(409,'TEAM_LOGIN_DISABLED');
     const body=await readJson(4096);
     return await edit(async()=>{
       if(!session(req))return fail(401,'AUTH_REQUIRED');
       if(!await password.verify(body?.currentPassword))return fail(403,'WRONG_PASSWORD');
       if(!validTeamPassword(body?.newPassword))return fail(422,'PASSWORD_POLICY');
       await password.replace(body.newPassword);
       sessions.clear();
       return send(200,{changed:true});
     });
   }
   if(req.method==='POST'&&p==='/api/logout'){
     const m=/(?:^|;\s*)ds_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie||'');if(m)sessions.delete(m[1]);return send(200,{ok:true},{'set-cookie':'ds_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});
   }
   if(req.method==='GET'&&p==='/api/workspace'){const saved=await workspace.read();return send(200,{saved,currentInputHash:saved?.workspace?.input?portableHash(saved.workspace.input):null});}
   if(req.method==='POST'&&p==='/api/workspace/preview')return send(200,workspace.preview(await readJson(40_000)));
   if(req.method==='POST'&&p==='/api/workspace/save'){
     const {expectedCurrentInputHash=null,...input}=await readJson(40_000);
     const saved=await edit(()=>workspace.save(input,{expectedCurrentInputHash}));
     return send(200,{workspace:saved,currentInputHash:portableHash(saved.input)});
   }
   if(req.method==='GET'&&p==='/api/workspace/export'){
     const data=await workspace.exportPortable();const body=JSON.stringify(data);
     res.writeHead(200,{'content-type':'application/json; charset=utf-8','content-disposition':'attachment; filename="dramasaku-proyek.json"','content-length':Buffer.byteLength(body),...security});res.end(body);return;
   }
   if(req.method==='POST'&&p==='/api/workspace/import'){
     const input=await readJson(90_000);if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['project','replace','expectedCurrentInputHash'].includes(k)))return fail(422,'PROJECT_IMPORT_INVALID');
     const imported=await edit(()=>workspace.importPortable(input.project,{replace:input.replace===true,expectedCurrentInputHash:input.expectedCurrentInputHash??null}));return send(200,{workspace:imported});
   }
   if(req.method==='GET'&&p==='/api/image/status')return send(200,{liveAvailable:false,configured:false,reason:'IMAGE_PROVIDER_ADAPTER_NOT_CONNECTED',paidCalls:false});
   if(req.method==='GET'&&p==='/api/seedance/catalog')return send(200,seedanceCatalog());
   if(req.method==='GET'&&p==='/api/tts/status'){const state=await tts.list(),projectId=await currentProject();state.jobs=state.jobs.filter(j=>!j.projectId||j.projectId===projectId);return send(200,state);}
   if(req.method==='POST'&&p==='/api/tts/preview')return send(200,tts.preview(await readJson(16000)));
   if(req.method==='POST'&&p==='/api/tts/draft')return send(201,{job:await tts.draft(await readJson(16000),{projectId:await currentProject()})});
   if(req.method==='GET'&&/^\/api\/tts\/jobs\/[a-f0-9]{24}\/draft$/.test(p))return send(200,{draft:await tts.readDraft(p.split('/')[4])});
   if(req.method==='POST'&&p==='/api/tts/generate')return send(201,{job:await tts.generate(await readJson(16000))});
   if(req.method==='GET'&&/^\/api\/tts\/jobs\/[a-f0-9]{24}\/audio$/.test(p)){
     const audio=await tts.audio(p.split('/')[4]);res.writeHead(200,{'content-type':'audio/mpeg','content-length':audio.size,'content-disposition':'inline; filename="dramasaku-narration.mp3"',...security});audio.stream.pipe(res);return;
   }
   if(req.method==='POST'&&/^\/api\/tts\/jobs\/[a-f0-9]{24}\/attach$/.test(p)){
     const audio=await tts.audio(p.split('/')[4]);const asset=await seedance.addAsset(audio.bytes,'dramasaku-voiceover.mp3',{projectId:await currentProject()});return send(201,{asset});
   }
   if(req.method==='GET'&&p==='/api/aiide-video/catalog')return send(200,aiideVideoCatalog());
   if(req.method==='POST'&&p==='/api/aiide-video/preview'){const input=await inspectInput(await readJson(16000));return send(200,compileAiideRequest(input,id=>seedance.resolveAsset(id)));}
   if(req.method==='POST'&&p==='/api/aiide-video/test')return send(200,await testAiideLocally(await readJson(16000),seedance));
   if(req.method==='GET'&&p==='/api/aiide-video/drafts'){const projectId=await currentProject(),jobs=seedance.listJobs().filter(j=>!j.projectId||j.projectId===projectId);return send(200,{jobs:jobs.filter(j=>j.provider==='aiide'),legacyJobs:jobs.filter(j=>j.provider!=='aiide')});}
   if(req.method==='POST'&&p==='/api/aiide-video/drafts'){const input=await inspectInput(await readJson(16000));return send(201,await seedance.createJob(input,{provider:'aiide',projectId:await currentProject()}));}
   if(req.method==='GET'&&/^\/api\/aiide-video\/drafts\/[a-f0-9]{24}$/.test(p)){const job=await seedance.getJob(p.split('/')[4]);if(job.provider!=='aiide')return fail(404,'JOB_NOT_FOUND');return send(200,{job});}
   if(req.method==='GET'&&p==='/api/production')return send(200,await production.state());
   if(req.method==='POST'&&/^\/api\/production\/(brief|review|timeline|render)$/.test(p)){const input=await readJson(30000);return send(p.endsWith('/render')?202:200,await edit(()=>production[p.split('/')[3]](input)));}
   if(req.method==='GET'&&/^\/api\/production\/renders\/[a-f0-9]{24}\/media$/.test(p)){const media=await production.media(p.split('/')[4]);res.writeHead(200,{'content-type':'video/mp4','content-length':media.size,'content-disposition':'inline; filename=dramasaku-film-lokal.mp4',...security});media.stream.pipe(res);return;}
   if(req.method==='GET'&&p==='/api/project-package/export'){const data=await edit(()=>packages.export());const body=JSON.stringify(data);res.writeHead(200,{'content-type':'application/json; charset=utf-8','content-disposition':'attachment; filename=dramasaku-project.studio.json','content-length':Buffer.byteLength(body),...security});res.end(body);return;}
   if(req.method==='POST'&&p==='/api/project-package/preview')return send(200,packages.preview(await readJson(95_000_000)));
   if(req.method==='POST'&&p==='/api/project-package/import'){const input=await readJson(95_000_000);return send(200,await edit(()=>packages.import(input)));}
   if(req.method==='GET'&&p==='/api/studio/status')return send(200,{version:'0.8.0',mode:'local_internal',tools:await localTools(),paidVideoEnabled:activation?(await activation.status()).ready:aiideVideoEnabled&&aiideVideoCapabilityVerified,paidTtsEnabled:ttsEnabled&&(ttsCapabilityVerified||aiideTtsCapabilityVerified),paidImageEnabled:false,readOnlyAiide:aiideReadOnlyEnabled,modelCount:aiideVideoCatalog().models.length,sharing:'portable_package',maxPackageMediaBytes:64*1024*1024,multiUser:false});
   if(req.method==='GET'&&p==='/api/aiide-video/status')return send(200,await aiideVideo.list());
   if(req.method==='POST'&&p==='/api/aiide-video/import')return send(201,{job:await aiideVideo.importTask(await readJson(3000))});
   if(req.method==='POST'&&p==='/api/aiide-video/submit'){const body=await readJson(16000);await inspectInput(body?.input);return send(201,{job:await aiideVideo.submit(body)});}
   if(req.method==='POST'&&/^\/api\/aiide-video\/jobs\/[a-f0-9]{24}\/check$/.test(p))return send(200,{job:await aiideVideo.check(p.split('/')[4])});
   if(req.method==='POST'&&/^\/api\/aiide-video\/jobs\/[a-f0-9]{24}\/attach$/.test(p)){
     const projectId=await currentProject();if(!projectId)return fail(409,'PROJECT_NOT_SAVED');
     const info=await aiideVideo.mediaPath(p.split('/')[4]);info.stream.destroy();
     if(info.size>20*1024*1024)return fail(413,'ASSET_TOO_LARGE');
     const bytes=await readFile(info.path),digest=createHash('sha256').update(bytes).digest('hex');
     const existing=seedance.listAssets().find(a=>a.projectId===projectId&&a.sha256===digest);
     const asset=existing||await seedance.addAsset(bytes,'aiide-'+p.split('/')[4]+'.mp4',{projectId});await seedance.inspectAsset(asset.id);return send(201,{asset});
   }
   if(req.method==='GET'&&/^\/api\/aiide-video\/jobs\/[a-f0-9]{24}\/media$/.test(p)){
     const info=await aiideVideo.mediaPath(p.split('/')[4]);
     res.writeHead(200,{'content-type':'video/mp4','content-length':info.size,'content-disposition':'inline; filename=dramasaku-aiide-video.mp4',...security});info.stream.pipe(res);return;
   }
   if(req.method==='GET'&&p==='/api/live/status')return send(200,await live.list());
   if(req.method==='POST'&&p==='/api/live/submit')return send(201,{job:await live.submit(await readJson(16000))});
   if(req.method==='POST'&&/^\/api\/live\/jobs\/[a-f0-9]{24}\/check$/.test(p))return send(200,{job:await live.check(p.split('/')[4])});
   if(req.method==='GET'&&/^\/api\/live\/jobs\/[a-f0-9]{24}\/media$/.test(p)){const info=await live.mediaPath(p.split('/')[4]);res.writeHead(200,{'content-type':'video/mp4','content-length':info.size,'content-disposition':'inline; filename=dramasaku-live.mp4',...security});info.stream.pipe(res);return;}
   if(req.method==='GET'&&p==='/api/seedance/assets'){const projectId=await currentProject();return send(200,{assets:seedance.listAssets().filter(a=>!a.projectId||a.projectId===projectId)});}
   if(req.method==='POST'&&/^\/api\/seedance\/assets\/[a-f0-9]{24}\/reference$/.test(p)){const {reference}=await readJson(3000);return send(200,{asset:await seedance.bindReference(p.split('/')[4],reference)});}
   if(req.method==='POST'&&/^\/api\/seedance\/assets\/[a-f0-9]{24}\/inspect$/.test(p))return send(200,{asset:await seedance.inspectAsset(p.split('/')[4])});
   if(req.method==='POST'&&p==='/api/seedance/assets'){
      const encoded=req.headers['x-asset-name']||'attachment';let name;try{name=decodeURIComponent(encoded);}catch{ return fail(422,'INVALID_ASSET_NAME');}
      const asset=await seedance.addAsset(await readBinary(),name,{projectId:await currentProject()});return send(201,{asset});
   }
   if(req.method==='GET'&&/^\/api\/seedance\/assets\/[a-f0-9]{24}\/media$/.test(p)){
      const id=p.split('/')[4],{asset,bytes}=await seedance.readAsset(id);
      res.writeHead(200,{'content-type':asset.mime,'content-length':bytes.length,'content-disposition':'inline',...security});res.end(bytes);return;
   }
   if(req.method==='GET'&&p==='/api/seedance/jobs')return send(200,{jobs:seedance.listJobs()});
   if(req.method==='GET'&&/^\/api\/seedance\/jobs\/[a-f0-9]{24}$/.test(p))return send(200,{job:await seedance.getJob(p.split('/')[4])});
   if(req.method==='POST'&&p==='/api/seedance/preview'){
      const input=await readJson();const plan=compileSeedanceRequest(input,id=>seedance.resolveAsset(id));return send(200,plan);
   }
   if(req.method==='POST'&&p==='/api/seedance/jobs'){
      const input=await readJson();const created=await seedance.createJob(input);return send(201,created);
   }
   if(req.method==='GET'&&p==='/api/key-pools')return send(200,await keyPools.list());
   if(req.method==='POST'&&p==='/api/key-pools'){
     const input=await readJson(),key=await keyPools.add(keyOnboardingInput(input));
     let connection=null;
     if(activation&&key.group==='video'&&key.provider==='aiide')connection=await activation.check(key.id);
     else if(!input.group&&['aiide','openai','google'].includes(key.provider)){
       try{connection=await keyConnection.test({keyId:key.id});}
       catch(e){connection={state:'unavailable',errorCode:e.code||'KEY_CHECK_UNAVAILABLE',matchingVideoModels:[]};}
     }
     return send(201,{key,connection});
   }
   if(req.method==='POST'&&p==='/api/key-pools/test'){
     const body=await readJson(1000);if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).join(',')!=='keyId')return fail(422,'KEY_CHECK_INPUT_INVALID');
     const key=(await keyPools.list()).pools.find(p=>p.id==='video')?.keys.find(k=>k.id===body.keyId);return send(200,activation&&key?.provider==='aiide'?await activation.check(body.keyId,{fresh:true}):await keyConnection.test(body));
   }
   if(req.method==='POST'&&p==='/api/key-pools/move-to-video'){
     const body=await readJson(1000);if(!body||Object.keys(body).join(',')!=='keyId')return fail(422,'KEY_CHECK_INPUT_INVALID');
     const key=await keyPools.moveToVideo(body.keyId);return send(200,{key,connection:activation?await activation.check(key.id,{fresh:true}):null});
   }
   if(req.method==='POST'&&p==='/api/key-pools/policy'){
      const {group,strategy}=await readJson();return send(200,await keyPools.setPolicy(group,strategy));
   }
   if(req.method==='POST'&&p==='/api/key-pools/preview'){
      const {group,provider}=await readJson();return send(200,await keyPools.preview(group,provider));
   }
   if(req.method==='POST'&&p==='/api/key-pools/update')return send(200,{key:await keyPools.update(await readJson())});
   if(req.method==='DELETE'&&/^\/api\/key-pools\/[a-f0-9]{24}$/.test(p))return send(200,await keyPools.remove(p.split('/')[3]));
   if(req.method==='GET'&&p==='/api/keys')return send(200,{slots:await vault.list(),usage:'encrypted-local-only; actual paid integrations disabled'});
   if(req.method==='POST'&&p==='/api/keys'){
      const {slot,secret}=await readJson();await vault.put(slot,secret);return send(200,{slot,configured:true,secretReturned:false});
   }
   if(req.method==='DELETE'&&p.startsWith('/api/keys/')){
     const slot=p.slice('/api/keys/'.length);await vault.remove(slot);return send(200,{slot,configured:false});
   }
   if(req.method==='GET'&&p==='/api/demo/state'){
     const {selectedTakes, ...state}=demo.getState();return send(200,{...state,selectedTakes:selectedTakes?.map(t=>({shotId:t.shotId,decision:t.decision}))??[]});
   }
   if(req.method==='POST'&&p.startsWith('/api/demo/')){
     const step=p.slice('/api/demo/'.length);if(step==='reset'){demo.reset();return send(200,{ok:true});}
     const allowed=['plan','approve','review','export','render','publish'];if(!allowed.includes(step))return fail(404,'UNKNOWN_ACTION');
     await demo.advance(step);return send(200,{step:demo.getState().step,ok:true});
   }
   if(req.method==='GET'&&p==='/api/demo/final.mp4'){
     const bytes=await demo.readOutput();res.writeHead(200,{'content-type':'video/mp4','content-length':bytes.length,...security});res.end(bytes);return;
   }
   return fail(404,'NOT_FOUND');
  }catch(e){const expected=['SECRET_INVALID','INVALID_PROVIDER_SLOT','INVALID_STATE','INVALID_ACTION','VAULT_FORMAT_INVALID'];return fail(e.status||(e.name==='DomainError'||expected.includes(e.code||e.message)?422:500),e.code||'SERVER_ERROR');}
 });
 return {server,vault,keyPools,demo,seedance,workspace,live,aiideVideo,tts,production,packages,listen:async()=>{await seedance.init();await live.init();await aiideVideo.init();await tts.init();await production.init();return new Promise(resolve=>server.listen(port,host,resolve));}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const port=Number(process.env.PORT||4184);const app=createLocalConsole({port});await app.listen();console.log(`Dramasaku offline operator console: http://127.0.0.1:${port} (local only; paid APIs disabled)`);}catch(e){console.error(`Cannot start local console: ${e.message}`);process.exitCode=1;}
}
