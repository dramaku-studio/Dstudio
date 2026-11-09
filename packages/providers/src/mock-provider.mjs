// Local deterministic fixture: no network, credentials, or costs.
export function createMockVideoProvider(){const tasks=new Map();return {
 validate(input){return Boolean(input?.prompt?.trim());},
 estimate(){return {amountMinor:100,currency:'IDR',estimated:true,source:'mock-fixture'};},
 async submit(input,{clientReference}={}){if(!input?.prompt?.trim())return {outcome:'rejected',code:'INVALID_PROMPT',definitelyNotAccepted:true};const id=`mock-${clientReference??tasks.size+1}`;if(!tasks.has(id))tasks.set(id,{state:'succeeded',output:{kind:'mock-video',uri:null}});return {outcome:'accepted',externalTaskId:id};},
 async getStatus(id){return tasks.get(id)??{state:'not_found'};},
 async cancel(id){if(!tasks.has(id))return {canceled:false};tasks.get(id).state='canceled';return {canceled:true};}
};}
