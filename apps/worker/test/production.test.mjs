import test from 'node:test';
import assert from 'node:assert/strict';
import {executeOneCycle} from '../production.mjs';
const job={id:'job1',orgId:'o',runId:'r',reservationId:'res',providerKey:'fixture',modelKey:'dev',input:{prompt:'hello'}};
const noop=()=>{};
const logger={warn:noop,info:noop};
const dbOps=(overrides={})=>({quarantineStaleSubmissions:async()=>0,claimNextSubmit:async()=>null,claimNextPoll:async()=>null,
 markAccepted:async()=>{},markUnknown:async()=>{},rejectDefinitely:async()=>{},deferPoll:async()=>{},
 completeVideo:async()=>{},blockFailedProviderJob:async()=>{},...overrides});
test('lost POST response creates unknown, never repeats the billable POST',async()=>{
 let posts=0,unknown=0;
 const provider={async submit(){posts++;throw new Error('simulated timeout');}};
 const ops=dbOps({claimNextSubmit:async()=>job,markUnknown:async()=>{unknown++;}});
 const result=await executeOneCycle({provider,pool:{},store:{},logger,dbOps:ops});
 assert.equal(posts,1);assert.equal(unknown,1);assert.equal(result.unknown,1);
});
test('explicit definitive rejection releases reservation instead of unknown',async()=>{
 let rejected=0,unknown=0;
 const ops=dbOps({claimNextSubmit:async()=>job,rejectDefinitely:async()=>{rejected++;},markUnknown:async()=>{unknown++;}});
 const provider={async submit(){return {outcome:'rejected',definitelyNotAccepted:true,code:'INVALID_PROMPT'};}};
 const result=await executeOneCycle({provider,pool:{},store:{},logger,dbOps:ops});
 assert.equal(rejected,1);assert.equal(unknown,0);assert.equal(result.rejected,1);
});
test('polling processing state is deferred, with no second POST',async()=>{
 let postponed=0;
 const ops=dbOps({claimNextPoll:async()=>({...job,externalTaskId:'provider-1'}),deferPoll:async()=>{postponed++;}});
 const result=await executeOneCycle({provider:{getStatus:async()=>({state:'processing'})},pool:{},store:{},logger,dbOps:ops});
 assert.equal(postponed,1);assert.equal(result.polling,1);
});
test('success ingests verified video and atomically commits media + cost',async()=>{
 let settled=0;
 const ops=dbOps({claimNextPoll:async()=>({...job,externalTaskId:'provider-1'}),
   completeVideo:async(_pool,_job,asset,actual)=>{assert.equal(actual,125);assert.match(asset.sha256,/^[a-f0-9]{64}$/);settled++;}});
 const provider={getStatus:async()=>({state:'succeeded',actualMinor:125}),openVideo:async()=>({stream:new Blob(['fixture']).stream()})};
 const store={ingest:async()=>({sha256:'b'.repeat(64),bytes:2000,width:320,height:480,durationSeconds:2})};
 const result=await executeOneCycle({provider,pool:{},store,logger,dbOps:ops});
 assert.equal(settled,1);assert.equal(result.ready,1);
});
test('provider failed does not silently release funds or set cost zero',async()=>{
 let blocked=0;
 const ops=dbOps({claimNextPoll:async()=>({...job,externalTaskId:'provider-1'}),blockFailedProviderJob:async()=>{blocked++;}});
 await executeOneCycle({provider:{getStatus:async()=>({state:'failed'})},pool:{},store:{},logger,dbOps:ops});
 assert.equal(blocked,1);
});
