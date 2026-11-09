/** Unified local creative workspace: deterministic planning only, no paid providers or real human approval. */
import {mkdir,readFile,rename,open,stat} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {parseScreenplay,lockCanonicalDNA,buildShotPlan,compileShotPrompt} from '../../packages/domain/src/creative.mjs';

function problem(code,detail){const e=new Error(detail);e.code=code;e.status=422;throw e;}
function safe(s,max=180){if(typeof s!=='string'||!s.trim()||s.length>max)problem('WORKSPACE_INVALID','A required field is empty or too long');return s.trim();}
function validateInput(v){
 if(!v||typeof v!=='object'||Array.isArray(v))problem('WORKSPACE_INVALID','Object required');
 const projectName=safe(v.projectName,120), screenplay=safe(v.screenplay,24000), visualStyle=safe(v.visualStyle,500);
 if(!Array.isArray(v.characters)||!v.characters.length||v.characters.length>30)problem('WORKSPACE_INVALID','1–30 characters required');
 const characters=v.characters.map((c,i)=>({id:`char-${i+1}`,name:safe(c.name,120).toUpperCase(),appearance:safe(c.appearance,900),wardrobe:safe(c.wardrobe,450)}));
 if(new Set(characters.map(x=>x.name)).size!==characters.length)problem('WORKSPACE_INVALID','Duplicate character names');
 if(!Number.isInteger(v.shotsPerScene)||v.shotsPerScene<1||v.shotsPerScene>5)problem('WORKSPACE_INVALID','Shot count must be 1–5');
 if(!Number.isInteger(v.durationSec)||v.durationSec<1||v.durationSec>60)problem('WORKSPACE_INVALID','Shot duration must be 1–60');
 return {projectName,screenplay,visualStyle,characters,shotsPerScene:v.shotsPerScene,durationSec:v.durationSec};
}
export function compileWorkspace(input){
 const sanitized=validateInput(input);const story=parseScreenplay(sanitized.screenplay);
 // ONLY for local prompt preview. This does NOT grant a production DNA/plan approval.
 const dna=lockCanonicalDNA({characters:sanitized.characters,visualStyle:sanitized.visualStyle,approverId:'local-fixture-planner-NOT-PRODUCTION-APPROVAL'});
 const plan=buildShotPlan({story,dna,shotsPerScene:sanitized.shotsPerScene,estimatedDurationSec:sanitized.durationSec});
 const prompts=plan.shots.map(shot=>compileShotPrompt({shot,dna,planHash:plan.planHash,providerCapability:{verified:true,version:'LOCAL-PREVIEW-ONLY',provider:'offline-preview',model:'no-provider'}}));
 return {input:sanitized,story:{scenes:story.scenes,storyHash:story.storyHash,characters:story.characters},dna:{characters:dna.characters,visualStyle:dna.visualStyle,contentHash:dna.contentHash,approval:'PREVIEW_ONLY'},plan:{planHash:plan.planHash,shots:plan.shots,nodes:plan.nodes,edges:plan.edges},prompts:prompts.map(x=>({shotId:x.shotId,prompt:x.prompt,promptHash:x.promptHash})),disclaimer:'LOCAL PLAN PREVIEW ONLY — no paid generation, locked DNA approval, or production authorizations.'};
}
/** Portable creative-plan-only export. Never contains API credentials, generation jobs or media. */
const PORTABLE_KIND='dramasaku.creative-project';
export const portableHash=input=>createHash('sha256').update(JSON.stringify(input)).digest('hex');
const portableFail=(code,status=422)=>Object.assign(new Error(code),{code,status});
export function exportCreativeProject(saved){
 if(!saved?.workspace?.input)throw portableFail('PROJECT_NOT_SAVED',404);
 const compiled=compileWorkspace(saved.workspace.input);
 return {kind:PORTABLE_KIND,version:1,scope:'creative-plan-only',
   exportedAt:new Date().toISOString(),input:compiled.input,
   integrity:{algorithm:'sha256',inputHash:portableHash(compiled.input),planHash:compiled.plan.planHash}};
}
export function validateCreativeProject(bundle){
 if(!bundle||typeof bundle!=='object'||Array.isArray(bundle))throw portableFail('PROJECT_IMPORT_INVALID');
 const keys=Object.keys(bundle),allowed=['kind','version','scope','exportedAt','input','integrity'];
 if(keys.some(k=>!allowed.includes(k))||keys.length!==allowed.length||bundle.kind!==PORTABLE_KIND||bundle.version!==1||bundle.scope!=='creative-plan-only')throw portableFail('PROJECT_IMPORT_INVALID');
 if(typeof bundle.exportedAt!=='string'||!/^\d{4}-\d\d-\d\dT/.test(bundle.exportedAt)||!Number.isFinite(Date.parse(bundle.exportedAt)))throw portableFail('PROJECT_IMPORT_INVALID');
 if(!bundle.integrity||typeof bundle.integrity!=='object'||Array.isArray(bundle.integrity)||Object.keys(bundle.integrity).sort().join(',')!=='algorithm,inputHash,planHash'||bundle.integrity.algorithm!=='sha256')throw portableFail('PROJECT_IMPORT_INVALID');
 if(!bundle.input||typeof bundle.input!=='object'||Array.isArray(bundle.input)||Object.keys(bundle.input).sort().join(',')!=='characters,durationSec,projectName,screenplay,shotsPerScene,visualStyle')throw portableFail('PROJECT_IMPORT_INVALID');
 const compiled=compileWorkspace(bundle.input);
 if(bundle.integrity.inputHash!==portableHash(compiled.input)||bundle.integrity.planHash!==compiled.plan.planHash)throw portableFail('PROJECT_INTEGRITY_MISMATCH');
 return compiled;
}
export function createWorkspaceStore({file}){
 let queued=Promise.resolve();
 async function read(){try{const v=JSON.parse(await readFile(file,'utf8'));return v?.schemaVersion===1?{...v,projectId:v.projectId||portableHash({legacyProject:v.workspace?.input?.projectName})}:null;}catch(e){if(e.code==='ENOENT')return null;throw e;}}
 async function writeCompiled(compiled,projectId=randomBytes(16).toString('hex')){
  await mkdir(dirname(file),{recursive:true,mode:0o700});
  const name=file+'.tmp-'+randomBytes(8).toString('hex');
  const h=await open(name,'wx',0o600);
  try{await h.writeFile(JSON.stringify({schemaVersion:1,projectId,updatedAt:new Date().toISOString(),workspace:compiled}));await h.sync();}finally{await h.close();}
  await rename(name,file);
  return compiled;
 }
 const serial=fn=>{const job=queued.then(fn);queued=job.catch(()=>{});return job;};
 async function save(input,{expectedCurrentInputHash=null}={}){
  const compiled=compileWorkspace(input);
  return serial(async()=>{
    const existing=await read();
    const current=existing?.workspace?.input?portableHash(existing.workspace.input):null;
    if(expectedCurrentInputHash!==current)throw portableFail('PROJECT_CHANGED_RELOAD',409);
    return writeCompiled(compiled,existing?.projectId);
  });
 }
 async function exportPortable(){await queued;return exportCreativeProject(await read());}
 async function importPortable(bundle,{replace=false,expectedCurrentInputHash=null,projectId}={}){
  const compiled=validateCreativeProject(bundle);
  return serial(async()=>{
    const existing=await read();
    if(existing){
      if(replace!==true)throw portableFail('PROJECT_REPLACE_CONFIRMATION_REQUIRED',409);
      if(typeof expectedCurrentInputHash!=='string'||expectedCurrentInputHash!==portableHash(existing.workspace.input))throw portableFail('PROJECT_CHANGED_RELOAD',409);
    }else if(expectedCurrentInputHash!==null)throw portableFail('PROJECT_CHANGED_RELOAD',409);
    return writeCompiled(compiled,projectId);
  });
 }
 return {read,save,preview:compileWorkspace,exportPortable,importPortable};
}
