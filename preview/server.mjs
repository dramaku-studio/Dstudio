// CP-002 inspectable preview. Runs without npm install. Not a production backend.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {validateDag, hashSnapshot, BudgetEnvelope, canDispatch, evaluateQuality, approveFinal, requireApprovedExport} from '../packages/domain/src/index.mjs';
import {NODE_TYPES} from '../packages/contracts/src/index.mjs';
import {createMockVideoProvider} from '../packages/providers/src/mock-provider.mjs';

const dir = dirname(fileURLToPath(import.meta.url));
const logo = join(dir, '../apps/web/public/dramasaku-logo.png');
const graph = NODE_TYPES.map((type,i) => ({id:`n${i+1}`,type}));
const edges = graph.slice(1).map((n,i)=>({from:graph[i].id,to:n.id}));
const capMinor = 400;
let run = initial();
function initial(){ return {status:'idle', planHash:null, approval:false, nodes:graph.map(n=>({...n,state:'pending'})), events:[], shots:[], budget:{capMinor,heldMinor:0,confirmedMinor:0}, manifest:null, mock:true}; }
function addEvent(action, detail){ run.events.unshift({time:new Date().toISOString(),action,detail}); run.events=run.events.slice(0,20); }
function view(){ return { ...run, note:'No DB, provider API, or real MP4. All generation and QA are mock fixtures.' }; }
function assert(condition, message){ if(!condition){ const e = new Error(message); e.statusCode=409; throw e; } }
function setNodes(completedTypes){run.nodes=graph.map(n=>({...n,state:completedTypes.includes(n.type)?'done':n.type==='TAKE_SELECT' && run.status==='awaiting_review'?'review':'pending'}));}
async function action(kind){
  if(kind==='reset'){run=initial();return view();}
  if(kind==='plan'){
    assert(run.status==='idle','Reset before creating a new plan');
    const order=validateDag(graph,edges);
    run.planHash=hashSnapshot({graph,edges,creativeInput:'CP002 offline demo story',version:1});
    run.status='awaiting_approval';
    setNodes(['STORY_PARSE']);
    addEvent('PLAN_VALIDATED',`${order.length} DAG nodes validated using @dramasaku/domain`);
    return view();
  }
  if(kind==='approve'){
    assert(run.status==='awaiting_approval','Plan is not awaiting approval');
    run.approval=true; run.status='scheduled';
    setNodes(['STORY_PARSE','DNA_LOCK','SHOT_PLAN']);
    addEvent('PLAN_APPROVED','Simulated reviewer approval (no real authentication)');
    return view();
  }
  if(kind==='execute'){
    assert(run.status==='scheduled','Plan must be approved first');
    const budget = new BudgetEnvelope(capMinor);
    const provider = createMockVideoProvider();
    const promptFixtures=['Wide establishing shot at sunrise','Character walks into the studio','Close-up of the character looking at camera'];
    const scores=[91,76,88];
    const shots=[];
    for(let i=0;i<promptFixtures.length;i++){
      canDispatch({runState:'scheduled',approvedPlanHash:run.planHash,currentPlanHash:run.planHash,approverId:'demo-reviewer',budget,estimatedCostMinor:100,capabilityVerified:true});
      budget.hold(`demo-shot-${i+1}`,100);
      const {externalTaskId}=await provider.submit({prompt:promptFixtures[i]},{clientReference:`preview-${i+1}`});
      const result=await provider.getStatus(externalTaskId);
      budget.settle(`demo-shot-${i+1}`,100);
      shots.push({id:`SHOT-${String(i+1).padStart(2,'0')}`,prompt:promptFixtures[i],providerTaskId:externalTaskId,assetVersionId:`mock-asset-v${i+1}`,providerState:result.state,uri:result.output.uri,score:scores[i],qa:evaluateQuality({score:scores[i]}),approved:false});
    }
    run.budget={capMinor,heldMinor:budget.heldMinor,confirmedMinor:budget.confirmedMinor};
    run.shots=shots;run.status='awaiting_review';
    setNodes(['STORY_PARSE','DNA_LOCK','SHOT_PLAN','IMAGE_GENERATE','I2V_COMPILE','VIDEO_GENERATE','QA_EVALUATE']);
    addEvent('MOCK_EXECUTION','3 mock jobs submitted, budget checks passed; no real video files');
    return view();
  }
  if(kind==='approve-takes'){
    assert(run.status==='awaiting_review','Takes are not awaiting review');
    run.shots=run.shots.map(s=>{ const approval=approveFinal({actorRole:'reviewer',actorId:'demo-reviewer',creatorId:'demo-generator',targetVersionId:s.assetVersionId});return {...s,approved:true,decision:approval.decision}; });
    run.status='ready_to_export';
    setNodes(NODE_TYPES.filter(t=>t!=='EXPORT_PACKAGE'));
    addEvent('TAKES_APPROVED','3 specific mock asset versions approved using domain guard');
    return view();
  }
  if(kind==='export'){
    assert(run.status==='ready_to_export','Approve takes before export');
    const takes=run.shots.map(s=>({shotId:s.id, assetVersionId:s.assetVersionId,decision:s.decision,planHash:run.planHash}));
    const approvedVersions=requireApprovedExport(takes,{expectedPlanHash:run.planHash,expectedAssetVersionsByShot:Object.fromEntries(takes.map(t=>[t.shotId,t.assetVersionId]))});
    run.manifest={kind:'demonstration_only',productionReady:false,planHash:run.planHash,assetVersions:approvedVersions,shots:run.shots,notice:'No MP4 produced or published; mock-provider uri=null'};
    run.status='completed';setNodes(NODE_TYPES);
    addEvent('EXPORT_DEMO','Versioned mock manifest created; no generated media');
    return view();
  }
  const e=new Error('Unknown action');e.statusCode=404;throw e;
}
const PORT=Number(process.env.PORT||4173);
const HOST=process.env.HOST||'127.0.0.1';
if (!['127.0.0.1','localhost','::1'].includes(HOST)) throw new Error('Preview can only bind loopback (not a public production server)');
const permittedOrigins=new Set([`http://127.0.0.1:${PORT}`,`http://localhost:${PORT}`,`http://[::1]:${PORT}`]);
const server=http.createServer(async(req,res)=>{
  const respond=(code,obj)=>{res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(obj));};
  const p=new URL(req.url,'http://localhost').pathname;
  try{
    if(req.method==='POST' && ((req.headers.origin && !permittedOrigins.has(req.headers.origin)) ||
       (req.headers['sec-fetch-site'] && !['same-origin','none'].includes(req.headers['sec-fetch-site'])))) {
      return respond(403,{error:'PREVIEW_ORIGIN_DENIED'});
    }
    if(req.method==='GET' && (p==='/'||p==='/index.html')){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(await readFile(join(dir,'index.html')));return;}
    if(req.method==='GET' && p==='/logo.png'){res.writeHead(200,{'content-type':'image/png','cache-control':'public, max-age=3600'});res.end(await readFile(logo));return;}
    if(req.method==='GET' && p==='/api/health') return respond(200,{ok:true,project:'dramasaku-studio',checkpoint:'CP-002',mode:'offline_mock',persistentDatabase:false,realGeneration:false});
    if(req.method==='GET' && p==='/api/state') return respond(200,view());
    if(req.method==='GET' && p==='/api/manifest') return respond(run.manifest?200:404,run.manifest??{error:'NO_MANIFEST'});
    if(req.method==='POST' && p.startsWith('/api/demo/')) return respond(200,await action(p.slice('/api/demo/'.length)));
    respond(404,{error:'NOT_FOUND'});
  }catch(e){respond(e.statusCode||500,{error:e.code||'DEMO_ERROR',message:e.message});}
});
server.listen(PORT,HOST,()=>console.log(`Dramasaku CP-002 offline mock preview at http://${HOST}:${PORT}`));
