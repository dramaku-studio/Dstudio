import {createMockVideoProvider} from '../../packages/providers/src/mock-provider.mjs';
const provider=createMockVideoProvider();
const {externalTaskId}=await provider.submit({prompt:'Fixture: camera slowly moves forward'},{clientReference:'cp001'});
const result=await provider.getStatus(externalTaskId);
console.log(JSON.stringify({checkpoint:'CP-001',worker:'mock-only',taskId:externalTaskId,result},null,2));
