import {compileAiideRequest} from '../../packages/providers/src/aiide-video-plan.mjs';
import {createAiideVideoAdapter} from '../../packages/providers/src/aiide-video-adapter.mjs';
/** Exercise the real compiler and adapter with an in-memory transport only. */
export async function testAiideLocally(input,assets){
 for(const ref of input.assets||[])await assets.inspectAsset(ref.assetId);
 const plan=compileAiideRequest(input,id=>assets.resolveAsset(id));
 const fixturePlan=compileAiideRequest(input,id=>({...assets.resolveAsset(id),providerReference:null}),{mockReferences:true});
 const calls=[];
 const adapter=createAiideVideoAdapter({apiKey:'local-contract-fixture-NOT-A-KEY',modelId:plan.model,networkAllowed:true,fetchImpl:async(url,options)=>{
  calls.push({method:options.method,url});
  if(options.method==='POST')return Response.json({task_id:'local-contract-test-0001',status:'SUBMITTED'});
  return Response.json({data:{status:'SUCCESS',data:{status:'succeeded',content:{video_url:'https://contract-fixture.example/sample.mp4'}}}});
 }});
 const task=await adapter.submit(fixturePlan),result=await adapter.getStatus(task.providerTaskId);
 if(calls.length!==2||calls[0].url!==plan.endpoint||result.state!=='succeeded')throw Error('LOCAL_CONTRACT_TEST_FAILED');
 return {state:'passed_local',plan,checks:['Mode dan model cocok','Parameter tervalidasi','Referensi lokal terbaca','Format request AIIDE sesuai profil','Respons task dan status terbaca'],simulatedRequests:calls.map(c=>({method:c.method,path:new URL(c.url).pathname})),outboundRequests:0,paidCalls:0,mediaGenerated:false,liveVerified:false};
}
