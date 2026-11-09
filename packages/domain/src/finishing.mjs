/** CP-005–008: human-signoff, export checks and dry-run publishing contracts.
 * These helpers cannot generate video or publish on their own.
 */
import {DomainError,hashSnapshot,requireApprovedExport,canRegenerate,evaluateQuality} from './index.mjs';
const error=(code,msg)=>{throw new DomainError(code,msg)};
export function evaluateTake({asset,shot,identityMatch,dialogueTranscript=null,cinematicScore=75}={}){
  if(!shot?.id||!asset?.sha256||!/^[0-9a-f]{64}$/.test(asset.sha256)||!asset?.assetVersionId||!(asset.durationSeconds>0)||!(asset.width>0)||!(asset.height>0))error('QUALITY_GATE_BLOCKED','G1 media integrity failure');
  const flags=[];if(identityMatch===false)flags.push('IDENTITY_MISMATCH');
  if(shot.dialogue?.length && dialogueTranscript===null)flags.push('DIALOGUE_UNVERIFIED');
  else if(shot.dialogue?.length && !shot.dialogue.every(d=>dialogueTranscript.includes(d.line)))flags.push('DIALOGUE_MISMATCH');
  const score=evaluateQuality({score:cinematicScore,criticalFlags:flags});
  return {assetVersionId:asset.assetVersionId,shotId:shot.id,technicalPassed:true,criticalFlags:flags,score:cinematicScore,decision:score,rubricVersion:'cp005-pilot-v1',evidence:{checksum:asset.sha256,measuredDuration:asset.durationSeconds,dimensions:[asset.width,asset.height]},humanApproved:false};
}
export function proposalForRevision({shotId,attempts,maxGenerations,estimatedMinor,remainingMinor,failedCriteria,impactNodeIds=[]}={}){
  if(!shotId||!Array.isArray(failedCriteria)||!failedCriteria.length)error('REVISION_INVALID','Shot and failure evidence required');
  canRegenerate({attempts,maxGenerations,remainingBudgetMinor:remainingMinor,quotedCostMinor:estimatedMinor});
  return {shotId,failedCriteria,impactedNodes:impactNodeIds,deltaCostMinor:estimatedMinor,requiresAuthorizedPolicy:true,status:'proposed'};
}
export function buildApprovedManifest({plan,selectedTakes,reviewerId}={}){
  if(!plan?.planHash||!reviewerId||!Array.isArray(selectedTakes))error('EXPORT_NOT_APPROVED','Manifest inputs missing');
  if(selectedTakes.length!==plan.shots.length)error('EXPORT_NOT_APPROVED','Missing required shots');
  const map=Object.fromEntries(selectedTakes.map(t=>[t.shotId,t.assetVersionId]));
  if(Object.keys(map).length!==selectedTakes.length||plan.shots.some(s=>!map[s.id]))error('EXPORT_NOT_APPROVED','Duplicate/unknown/missing shot');
  for(const t of selectedTakes){
    if(t.reviewerId!==reviewerId||t.planHash!==plan.planHash)error('EXPORT_NOT_APPROVED','Reviewer or version mismatch');
    if(t.criticalFlags?.length && !(t.exception?.approvedBy===reviewerId && typeof t.exception.reason==='string' && t.exception.reason.trim().length>=20))error('EXPORT_NOT_APPROVED','Critical flags require documented reviewer exception');
  }
  requireApprovedExport(selectedTakes,{expectedPlanHash:plan.planHash,expectedAssetVersionsByShot:map});
  const entries=plan.shots.map(s=>{const take=selectedTakes.find(t=>t.shotId===s.id);return {shotId:s.id,sceneId:s.sceneId,assetVersionId:take.assetVersionId,sha256:take.sha256??null,durationSec:s.durationSec};});
  const manifest={schemaVersion:1,planHash:plan.planHash,reviewerId,entries,kind:'approved_takes_edit_ready'};
  return {...manifest,selectionHash:hashSnapshot(entries)};
}
const PLATFORMS=new Set(['youtube','instagram','tiktok','facebook','threads','pinterest','linkedin','bluesky']);
export function preparePublishDryRun({finalRender,platform,accountRef,caption,releaseApproval}={}){
  if(!PLATFORMS.has(platform)||typeof accountRef!=='string'||!/^[-\w:.]{3,120}$/.test(accountRef)||typeof caption!=='string'||caption.trim().length<1||caption.length>2200)error('PUBLISH_INVALID','Invalid platform, account or caption');
  if(!finalRender?.sha256||!/^[0-9a-f]{64}$/.test(finalRender.sha256)||!finalRender.assetVersionId||releaseApproval?.assetVersionId!==finalRender.assetVersionId||releaseApproval?.decision!=='approved'||!releaseApproval.actorId)error('PUBLISH_NOT_APPROVED','Approved final render and release authorization required');
  const preview={platform,accountRef,caption,assetVersionId:finalRender.assetVersionId,sha256:finalRender.sha256};
  return {...preview,deduplicationKey:hashSnapshot(preview),status:'dry_run_only',networkCalls:0};
}
