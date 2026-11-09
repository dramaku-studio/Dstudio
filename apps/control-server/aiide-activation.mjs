/** Credential/catalog readiness is not a guarantee of credit, entitlement or successful generation. */
import {createProviderConnectionTester} from './provider-connection.mjs';
export function createAiideActivation({keyPools,fetchImpl=fetch,clock=Date.now,ttlMs=30000}={}){
 const tester=createProviderConnectionTester({keyPools,fetchImpl,cooldownMs:0});
 const cache=new Map(),pending=new Map();
 async function check(keyId,{fresh=false}={}){
  const snapshot=await keyPools.list();
  const key=snapshot.pools.find(p=>p.id==='video')?.keys.find(k=>k.id===keyId&&k.provider==='aiide'&&k.enabled);
  if(!key){cache.delete(keyId);return {state:'disabled',matchingVideoModels:[]};}
  if(!fresh&&cache.has(keyId)&&clock()-cache.get(keyId).time<ttlMs)return cache.get(keyId).result;
  if(pending.has(keyId)){await pending.get(keyId);if(!fresh)return cache.get(keyId).result;}
  const task=(async()=>{
   let result;try{result=await tester.test({keyId});}catch(e){result={state:'unavailable',errorCode:e.code||'KEY_CHECK_UNAVAILABLE',matchingVideoModels:[]};}
   cache.set(keyId,{time:clock(),result});return result;
  })();pending.set(keyId,task);
  try{return await task;}finally{pending.delete(keyId);}
 }
 async function status({cachedOnly=false}={}){
  const selected=(await keyPools.preview('video','aiide')).selected;
  if(!selected)return {ready:false,state:'no_available_key',models:[]};
  const cached=cache.get(selected.id);
  const result=cachedOnly?(cached&&clock()-cached.time<ttlMs?cached.result:{state:'unchecked',matchingVideoModels:[]}):await check(selected.id);
  const models=result.matchingVideoModels||[];
  return {ready:result.state==='connected'&&models.length>0,state:result.state==='connected'&&!models.length?'catalog_not_supported':result.state,keyId:selected.id,models,catalogModels:result.modelIds||[]};
 }
 async function authorize(keyId,model){
  const result=await check(keyId,{fresh:true});
  if(result.state!=='connected')throw Object.assign(Error('AIIDE_KEY_NOT_VERIFIED'),{code:'AIIDE_KEY_NOT_VERIFIED',status:403});
  if(!result.matchingVideoModels.includes(model))throw Object.assign(Error('AIIDE_MODEL_NOT_AVAILABLE'),{code:'AIIDE_MODEL_NOT_AVAILABLE',status:403});
 }
 return {check,status,authorize};
}
