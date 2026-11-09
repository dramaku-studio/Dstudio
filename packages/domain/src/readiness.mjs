/** Live eligibility policy: fail-closed. Never treat a configured API key as readiness. */
const REQUIRED=['postgresIntegration','authorization','secretManager','providerEntitlements','providerCapabilityAndPricing','privateDurableStorage','billingReconciliation','approvalService','publishingOAuth','observability','securityReview'];
export function evaluateLiveReadiness(gates={}){
 const blockers=REQUIRED.filter(key=>gates?.[key]!==true);
 return {eligible:blockers.length===0,paidGenerationAllowed:blockers.length===0,publishingAllowed:blockers.length===0,blockers};
}
export function assertPaidDispatchAllowed({flags={},gates={}}={}){
 const readiness=evaluateLiveReadiness(gates);
 if(flags.paidGenerationEnabled!==true||!readiness.eligible)throw Object.assign(new Error('LIVE_GATES_UNMET'),{code:'LIVE_GATES_UNMET',blockers:readiness.blockers});
 return true;
}
