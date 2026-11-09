/** CP-004: deterministic, provider-independent story/shot planning.
 * Never call an LLM from this module. Text and references are untrusted data.
 */
import {createHash} from 'node:crypto';
import {DomainError, hashSnapshot, validateDag} from './index.mjs';
const fail=(code,message)=>{throw new DomainError(code,message)};
const clean=(v,max=250)=>typeof v==='string'&&v.trim()&&v.length<=max?v.trim():fail('INVALID_STORY','Missing/oversized text');
const H=/^(INT\.|EXT\.|INT\/EXT\.|SCENE\s+\d+\b)/i;
const DIA=/^[A-Z][A-Z0-9 _'-]{1,25}$/;
const sha=s=>createHash('sha256').update(s).digest('hex');
export function parseScreenplay(input,{maxScenes=20,maxCharacters=30}={}){
  if(typeof input!=='string'||input.trim().length<12||input.length>24000||input.includes('\0')) fail('INVALID_STORY','Screenplay must contain 12–24000 characters without NUL');
  const lines=input.replace(/\r/g,'').split('\n');
  const scenes=[];let cur=null;
  for(let i=0;i<lines.length;i++){
    const line=lines[i].trim();if(!line)continue;
    if(H.test(line)){
      if(scenes.length>=maxScenes)fail('STORY_LIMIT','Too many scenes');
      cur={id:`SC-${String(scenes.length+1).padStart(3,'0')}`,heading:clean(line,160),action:[],dialogue:[]}; scenes.push(cur);continue;
    }
    if(!cur){cur={id:'SC-001',heading:'SCENE 1',action:[],dialogue:[]};scenes.push(cur);}
    if(DIA.test(line)&&i+1<lines.length&&lines[i+1].trim()&&!H.test(lines[i+1].trim())&&scenes.length){
      const next=lines[i+1].trim();if(next.length>1500)fail('STORY_LIMIT','Dialogue too long');
      cur.dialogue.push({character:line,line:next});i++;continue;
    }
    cur.action.push(line);
  }
  if(!scenes.length||scenes.every(s=>!s.action.length&&!s.dialogue.length))fail('INVALID_STORY','No actionable content');
  const characters=[...new Set(scenes.flatMap(s=>s.dialogue.map(d=>d.character)))];
  if(characters.length>maxCharacters)fail('STORY_LIMIT','Too many speaking characters');
  const normalized=scenes.map(s=>({...s,action:s.action.join(' '),dialogueHash:hashSnapshot(s.dialogue)}));
  return {storyHash:sha(input.replace(/\r/g,'')),schemaVersion:1,scenes:normalized,characters,dialogueLockHash:hashSnapshot(normalized.map(s=>[s.id,s.dialogue]))};
}
export function lockCanonicalDNA({characters,locations=[],visualStyle,version=1,approverId}={}){
  if(!approverId||!Number.isInteger(version)||version<1||!Array.isArray(characters)||!characters.length||characters.length>30||!Array.isArray(locations)||locations.length>50)fail('DNA_INVALID','Characters and authorized approver required');
  const ids=new Set();
  const cc=characters.map(c=>{
    const id=clean(c?.id,64);if(ids.has(id))fail('DNA_INVALID','Duplicate character');ids.add(id);
    return {id,name:clean(c.name,120),appearance:clean(c.appearance,1000),wardrobe:clean(c.wardrobe,500),referenceAssetVersion:c.referenceAssetVersion?clean(c.referenceAssetVersion,128):null};
  });
  const ll=locations.map(l=>({id:clean(l.id,64),description:clean(l.description,1000)}));
  const dna={version,characters:cc,locations:ll,visualStyle:clean(visualStyle,1000),approvedBy:clean(approverId,128)};
  return Object.freeze({...dna,contentHash:hashSnapshot(dna),locked:true});
}
export function buildShotPlan({story,dna,skillVersion='v1',compilerVersion='cp004-v1',shotsPerScene=2,estimatedDurationSec=6}={}){
  if(!story?.scenes?.length||story.schemaVersion!==1||!dna?.locked||!dna.contentHash)fail('PLAN_INVALID','Parsed story and locked DNA required');
  if(!Number.isInteger(shotsPerScene)||shotsPerScene<1||shotsPerScene>5||!Number.isInteger(estimatedDurationSec)||estimatedDurationSec<1||estimatedDurationSec>60)fail('PLAN_INVALID','Invalid shot bounds');
  if(story.scenes.length*shotsPerScene>80)fail('PLAN_INVALID','Shot count limit 80');
  const shots=[];const nodes=[{id:'story',type:'STORY_PARSE'},{id:'dna',type:'DNA_LOCK'},{id:'plan',type:'SHOT_PLAN'}];
  const edges=[{from:'story',to:'dna'},{from:'dna',to:'plan'}];
  for(const [sIndex,scene] of story.scenes.entries()){
    const unregistered=scene.dialogue.filter(d=>!dna.characters.some(c=>c.name.toUpperCase()===d.character));
    if(unregistered.length)fail('DNA_MISMATCH',`Unregistered speaker in ${scene.id}: ${unregistered[0].character}`);
    for(let i=0;i<shotsPerScene;i++){
      const id=`${scene.id}-SH-${String(i+1).padStart(2,'0')}`;
      const shot={id,sceneId:scene.id,sequence:shots.length+1,description:scene.action||scene.heading,framing:i===0?'wide establishing':'medium close-up',durationSec:estimatedDurationSec,dialogue:scene.dialogue,dialogueHash:scene.dialogueHash,dnaHash:dna.contentHash,storyHash:story.storyHash,sceneIndex:sIndex};shots.push(shot);
      let parent='plan';
      for(const [suffix,type] of [['image','IMAGE_GENERATE'],['i2v','I2V_COMPILE'],['video','VIDEO_GENERATE'],['qa','QA_EVALUATE'],['take','TAKE_SELECT']]){
        const n=`${id}:${suffix}`;nodes.push({id:n,type});edges.push({from:parent,to:n});parent=n;
      }
    }
  }
  const exp='export';nodes.push({id:exp,type:'EXPORT_PACKAGE'});
  for(const shot of shots)edges.push({from:`${shot.id}:take`,to:exp});
  validateDag(nodes,edges);
  const planBase={storyHash:story.storyHash,dnaHash:dna.contentHash,skillVersion:clean(skillVersion,128),compilerVersion:clean(compilerVersion,128),shots,nodes,edges};
  return {...planBase,planHash:hashSnapshot(planBase)};
}
export function compileShotPrompt({shot,dna,planHash,providerCapability}={}){
  if(!shot||!dna?.locked||dna.contentHash!==shot.dnaHash||!planHash||!providerCapability?.verified||!providerCapability?.version)fail('CAPABILITY_UNVERIFIED','Locked inputs and verified capability required');
  const cast=dna.characters.map(c=>`${c.name}: ${c.appearance}; wardrobe: ${c.wardrobe}`).join(' | ');
  const prompt=`Visual style: ${dna.visualStyle}\nShot: ${shot.framing}, ${shot.durationSec}s. ${shot.description}\nCharacters: ${cast}\nDialogue (do not rewrite): ${shot.dialogue.map(d=>`${d.character}: ${d.line}`).join(' / ')||'none'}\nPreserve character identity and continuity across shots.`;
  const snapshot={shotId:shot.id,planHash,dnaHash:dna.contentHash,dialogueHash:shot.dialogueHash,provider:clean(providerCapability.provider,80),model:clean(providerCapability.model,80),capabilityVersion:clean(providerCapability.version,80),prompt};
  return {...snapshot,promptHash:hashSnapshot(snapshot)};
}
