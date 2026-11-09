/** Offline end-to-end creative/render/publish simulation; NO paid providers or network posting. */
import {readFile,mkdir,stat,chmod} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {parseScreenplay,lockCanonicalDNA,buildShotPlan,compileShotPrompt} from '../../packages/domain/src/creative.mjs';
import {evaluateTake,buildApprovedManifest,preparePublishDryRun} from '../../packages/domain/src/finishing.mjs';
const exec=promisify(execFile);
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const sample='INT. STUDIO - DAY\nRANI\nAku pulang.\nRani membuka pintu dan masuk ke studio.\n\nEXT. JALAN - EVENING\nRANI\nSampai jumpa.\nRani berjalan menjauh.';
const sha256=b=>createHash('sha256').update(b).digest('hex');
export function createOfflineDemo({getCreativeInput=async()=>null,fixture=join(root,'fixtures','fixture-video.mp4'),output=join(root,'.local-private','final-demo.mp4'),execImpl=exec}={}){
 let state={step:'idle',events:[],plan:null,manifest:null,render:null,publishing:null,disclaimer:'OFFLINE FIXTURE ONLY — no real AI generation, no paid API, no platform upload.'};
 const add=(label)=>{state.events.unshift({time:new Date().toISOString(),label});state.events=state.events.slice(0,20);};
 const ensure=(step)=>{if(state.step!==step)throw Object.assign(new Error(`ACTION_INVALID: need ${step}, currently ${state.step}`),{code:'INVALID_STATE'});};
 return {
  getState(){return state;},
  reset(){state={step:'idle',events:[],plan:null,manifest:null,render:null,publishing:null,disclaimer:'OFFLINE FIXTURE ONLY — no real AI generation, no paid API, no platform upload.'};return state;},
  async advance(action){
    if(action==='plan'){
      ensure('idle');
      const supplied=await getCreativeInput();const script=supplied?.screenplay||sample;
      const story=parseScreenplay(script);const dna=lockCanonicalDNA({approverId:'local-demo-reviewer',visualStyle:supplied?.visualStyle||'cinematic, warm low-key lighting',characters:supplied?.characters?.map((c,i)=>({...c,id:c.id||`char-${i+1}`}))||[{id:'char-rani',name:'RANI',appearance:'adult with shoulder-length dark hair',wardrobe:'red jacket'}],locations:[{id:'loc-studio',description:'cozy interior'}]});
      const plan=buildShotPlan({story,dna,shotsPerScene:supplied?.shotsPerScene??2,estimatedDurationSec:supplied?.durationSec??6});
      state.plan={story, dna, projectName:supplied?.projectName||'Offline Demo Project', ...plan, prompts:plan.shots.map(shot=>compileShotPrompt({shot,dna,planHash:plan.planHash,providerCapability:{verified:true,version:'fixture-only-v1',provider:'offline-fixture',model:'none'}}))};state.step='awaiting_approval';add(`Story + preview DNA + ${plan.shots.length}-shot DAG compiled (${supplied?'saved workspace':'built-in fixture'})`);return state;
    }
    if(action==='approve'){
      ensure('awaiting_approval');state.plan.approverId='local-demo-reviewer';state.step='awaiting_take_review';add('Demo plan approved by local session (NOT real RBAC)');return state;
    }
    if(action==='review'){
      ensure('awaiting_take_review');const bytes=await readFile(fixture);const sha=sha256(bytes);
      state.selectedTakes=state.plan.shots.map(shot=>{
        const assetVersionId=`fixture-${shot.id}-v1`;
        const qa=evaluateTake({shot,asset:{assetVersionId,sha256:sha,durationSeconds:2,width:480,height:854},identityMatch:true,cinematicScore:90});
        return {...qa,shotId:shot.id,assetVersionId,sha256:sha,decision:'approved',reviewerId:'local-demo-reviewer',planHash:state.plan.planHash,exception:{approvedBy:'local-demo-reviewer',reason:'Fixture has no synchronized spoken dialogue. This is a simulation exception, NOT a creative approval for real assets.'}};
      });state.step='ready_to_export';add('4 fixture takes selected with explicit AUDIO_UNVERIFIED exception (demo only)');return state;
    }
    if(action==='export'){
      ensure('ready_to_export');state.manifest=buildApprovedManifest({plan:state.plan,selectedTakes:state.selectedTakes,reviewerId:'local-demo-reviewer'});state.step='ready_to_render';add('Approved asset-version manifest created');return state;
    }
    if(action==='render'){
      ensure('ready_to_render');if(!state.manifest?.entries?.length)throw new Error('Manifest missing');
      await mkdir(dirname(output),{recursive:true,mode:0o700});
      // Fixture input is a single trusted file packaged by Dramasaku. Output not user-controlled.
      await execImpl('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y','-stream_loop','2','-i',fixture,'-t','6','-an','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',output],{timeout:90000,maxBuffer:100000});
      await chmod(output,0o600);const file=await readFile(output);if(!(await stat(output)).size)throw new Error('Rendered video empty');
      state.render={assetVersionId:'demo-final-v1',sha256:sha256(file),bytes:file.length,mediaType:'video/mp4',note:'6-second video assembled from repeated FFmpeg fixture; NOT generated by AI'};
      state.step='ready_to_publish_dry_run';add('Rendered playable MP4 fixture composition; manual release still required');return state;
    }
    if(action==='publish'){
      ensure('ready_to_publish_dry_run');state.publishing=preparePublishDryRun({finalRender:state.render,platform:'youtube',accountRef:'demo-account',caption:'Dramasaku offline test — fixture only',releaseApproval:{assetVersionId:state.render.assetVersionId,actorId:'local-demo-reviewer',decision:'approved'}});
      state.step='completed_dry_run';add('Publishing envelope prepared; network POST count = 0');return state;
    }
    throw Object.assign(new Error('Unknown demo action'),{code:'INVALID_ACTION'});
  },
  async readOutput(){if(!state.render)throw new Error('No render');return readFile(output);}
 };
}
