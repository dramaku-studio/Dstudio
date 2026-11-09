/** CP-003 private worker repository. All functions require trusted server-side callers. */
import {DomainError} from '../../domain/src/index.mjs';

async function tx(pool,fn){const db=await pool.connect();try{await db.query('BEGIN');const result=await fn(db);await db.query('COMMIT');return result;}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}}

/** Atomic dispatch claim. A crash after this commit leaves an ambiguous POST, NEVER a retryable queued job. */
export async function claimNextSubmit(pool){
 return tx(pool,async db=>{
   const {rows}=await db.query(`SELECT j.id,j.run_id,j.reservation_id,j.org_id,j.node_key,j.provider_key,j.model_key,j.input_snapshot
     FROM generation_jobs j
     JOIN production_runs r ON r.id=j.run_id AND r.org_id=j.org_id
     JOIN production_plans p ON p.id=r.plan_id AND p.org_id=r.org_id
     JOIN run_budget_accounts b ON b.run_id=j.run_id AND b.org_id=j.org_id
     JOIN budget_reservations h ON h.id=j.reservation_id AND h.run_id=j.run_id
     JOIN provider_capabilities c ON c.id=h.capability_id AND c.org_id=j.org_id
     WHERE j.state='queued' AND r.status IN ('scheduled','running')
       AND p.status='approved' AND r.plan_hash=p.plan_hash AND p.quote_expires_at>now()
       AND b.blocked_reason IS NULL AND h.state='held' AND h.submission_state='reserved'
       AND c.enabled=true AND c.expires_at>now() AND c.provider_key=j.provider_key AND c.model_key=j.model_key
     ORDER BY j.created_at,j.id FOR UPDATE OF r SKIP LOCKED LIMIT 1`);
   const j=rows[0];if(!j)return null;
   const {rows:b}=await db.query(`SELECT blocked_reason FROM run_budget_accounts WHERE run_id=$1 AND org_id=$2 FOR UPDATE`,[j.run_id,j.org_id]);
   if(!b.length || b[0].blocked_reason)return null;
   // Recheck capability immediately before billable POST, not only at reservation time.
   const {rows:cap}=await db.query(`SELECT c.id FROM provider_capabilities c
     JOIN budget_reservations r ON r.capability_id=c.id
     WHERE r.id=$1 AND r.run_id=$2 AND c.org_id=$3 AND c.enabled=true AND c.expires_at>now()
       AND c.provider_key=$4 AND c.model_key=$5 FOR SHARE OF c`,
       [j.reservation_id,j.run_id,j.org_id,j.provider_key,j.model_key]);
   if(!cap.length)return null;
   const {rows:hold}=await db.query(`SELECT state,submission_state FROM budget_reservations WHERE id=$1 AND run_id=$2 FOR UPDATE`,[j.reservation_id,j.run_id]);
   if(hold[0]?.state!=='held' || hold[0]?.submission_state!=='reserved')return null;
   const {rows:locked}=await db.query(`SELECT state FROM generation_jobs WHERE id=$1 FOR UPDATE`,[j.id]);
   if(locked[0]?.state!=='queued')return null;
   await db.query(`UPDATE generation_jobs SET state='submitting',started_at=now(),updated_at=now() WHERE id=$1`,[j.id]);
   await db.query(`UPDATE budget_reservations SET submission_state='submitting' WHERE id=$1 AND state='held' AND submission_state='reserved'`,[j.reservation_id]);
   return {id:j.id,orgId:j.org_id,runId:j.run_id,reservationId:j.reservation_id,providerKey:j.provider_key,
     modelKey:j.model_key,input:j.input_snapshot};
 });
}

export async function markAccepted(pool,job,externalTaskId){
 if(typeof externalTaskId!=='string'||!externalTaskId||externalTaskId.length>128)throw new DomainError('INVALID_REQUEST','Invalid provider task ID');
 return tx(pool,async db=>{
   // Lock in run -> budget -> reservation -> job order shared with rejection/settlement.
   const {rows:r}=await db.query(`SELECT id FROM production_runs WHERE id=$1 AND org_id=$2 FOR UPDATE`,[job.runId,job.orgId]);
   if(!r.length)throw new DomainError('NOT_FOUND','Run missing');
   await db.query(`SELECT run_id FROM run_budget_accounts WHERE run_id=$1 FOR UPDATE`,[job.runId]);
   const {rows:hold}=await db.query(`SELECT state FROM budget_reservations WHERE id=$1 AND run_id=$2 FOR UPDATE`,[job.reservationId,job.runId]);
   const {rows}=await db.query(`SELECT state,external_task_id FROM generation_jobs WHERE id=$1 AND org_id=$2 FOR UPDATE`,[job.id,job.orgId]);
   const old=rows[0];if(!old)throw new DomainError('NOT_FOUND','Job missing');
   if(old.state==='submitted'&&old.external_task_id===externalTaskId)return {replayed:true};
   if(old.state!=='submitting'||hold[0]?.state!=='held')throw new DomainError('INVALID_STATE','Cannot accept job outside submitting');
   await db.query(`UPDATE generation_jobs SET state='submitted',external_task_id=$2,poll_after=now(),updated_at=now() WHERE id=$1`,[job.id,externalTaskId]);
   await db.query(`UPDATE budget_reservations SET submission_state='submitted' WHERE id=$1`,[job.reservationId]);
   return {replayed:false};
 });
}

export async function markUnknown(pool,job,reason='POST_OUTCOME_UNKNOWN'){
 return tx(pool,async db=>{
   const {rows:r}=await db.query(`SELECT id FROM production_runs WHERE id=$1 AND org_id=$2 FOR UPDATE`,[job.runId,job.orgId]);
   if(!r.length)throw new DomainError('NOT_FOUND','Run missing');
   await db.query(`SELECT run_id FROM run_budget_accounts WHERE run_id=$1 FOR UPDATE`,[job.runId]);
   const {rows:jobs}=await db.query(`SELECT state FROM generation_jobs WHERE id=$1 FOR UPDATE`,[job.id]);
   if(jobs[0]?.state==='submission_unknown')return {replayed:true};
   if(jobs[0]?.state!=='submitting')throw new DomainError('INVALID_STATE','Only submitting can become unknown');
   await db.query(`UPDATE generation_jobs SET state='submission_unknown',error_code=$2,updated_at=now() WHERE id=$1`,[job.id,reason]);
   await db.query(`UPDATE budget_reservations SET submission_state='unknown' WHERE id=$1`,[job.reservationId]);
   await db.query(`UPDATE run_budget_accounts SET blocked_reason='submission_unknown',row_version=row_version+1 WHERE run_id=$1`,[job.runId]);
   await db.query(`INSERT INTO outbox_events(org_id,event_type,aggregate_id,payload) VALUES($1,'generation.submission_unknown',$2,$3::jsonb)`,
     [job.orgId,job.reservationId,JSON.stringify({runId:job.runId,reservationId:job.reservationId,reason})]);
   return {replayed:false};
 });
}

/** Only after provider certifies request was NEVER accepted. Preserves immutable accounting trail. */
export async function rejectDefinitely(pool,job,reason='PROVIDER_REJECTED'){
 return tx(pool,async db=>{
   await db.query(`SELECT id FROM production_runs WHERE id=$1 AND org_id=$2 FOR UPDATE`,[job.runId,job.orgId]);
   await db.query(`SELECT run_id FROM run_budget_accounts WHERE run_id=$1 FOR UPDATE`,[job.runId]);
   const {rows:r}=await db.query(`SELECT amount_minor,state FROM budget_reservations WHERE id=$1 FOR UPDATE`,[job.reservationId]);
   const {rows:j}=await db.query(`SELECT state FROM generation_jobs WHERE id=$1 FOR UPDATE`,[job.id]);
   if(j[0]?.state==='provider_rejected')return {replayed:true};
   if(j[0]?.state!=='submitting'||r[0]?.state!=='held')throw new DomainError('INVALID_STATE','Cannot release ambiguous or accepted submission');
   await db.query(`UPDATE budget_reservations SET state='released',submission_state='reconciled' WHERE id=$1`,[job.reservationId]);
   await db.query(`UPDATE run_budget_accounts SET held_minor=held_minor-$2,row_version=row_version+1 WHERE run_id=$1`,[job.runId,r[0].amount_minor]);
   await db.query(`INSERT INTO usage_ledger(run_id,reservation_id,entry_type,delta_held_minor,actor_type,detail) VALUES($1,$2,'release',$3,'provider',$4::jsonb)`,
     [job.runId,job.reservationId,-BigInt(r[0].amount_minor).toString(),JSON.stringify({reason})]);
   await db.query(`UPDATE generation_jobs SET state='provider_rejected',error_code=$2,finished_at=now(),updated_at=now() WHERE id=$1`,[job.id,reason]);
   return {replayed:false};
 });
}

/** Acquiring a polling lease is safe: repeated GETs do not create billable work. */
export async function claimNextPoll(pool){
 return tx(pool,async db=>{
   const {rows}=await db.query(`SELECT * FROM generation_jobs WHERE
     (state='submitted' AND poll_after<=now()) OR (state='polling' AND lease_expires_at<now())
     ORDER BY poll_after,id FOR UPDATE SKIP LOCKED LIMIT 1`);
   const j=rows[0];if(!j)return null;
   await db.query(`UPDATE generation_jobs SET state='polling',lease_expires_at=now()+interval '90 seconds',updated_at=now() WHERE id=$1`,[j.id]);
   return {id:j.id,runId:j.run_id,orgId:j.org_id,reservationId:j.reservation_id,externalTaskId:j.external_task_id,providerKey:j.provider_key};
 });
}
export async function deferPoll(pool,job,{delaySeconds=10,reason=null}={}){
 const delay=Math.max(1,Math.min(300,Math.round(delaySeconds)));
 return tx(pool,async db=>{
   await db.query(`SELECT id FROM production_runs WHERE id=$1 AND org_id=$2 FOR UPDATE`,[job.runId,job.orgId]);
   await db.query(`SELECT run_id FROM run_budget_accounts WHERE run_id=$1 FOR UPDATE`,[job.runId]);
   const {rows}=await db.query(`SELECT state,poll_errors FROM generation_jobs WHERE id=$1 FOR UPDATE`,[job.id]);
   if(rows[0]?.state!=='polling')return false;
   const errors=reason?rows[0].poll_errors+1:0;
   const fatal=errors>=5;
   await db.query(`UPDATE generation_jobs SET state=$2,poll_errors=$3,
      poll_after=now()+($4::integer * interval '1 second'),lease_expires_at=NULL,error_code=$5,updated_at=now()
      WHERE id=$1`,[job.id,fatal?'provider_failed_unsettled':'submitted',errors,delay,reason]);
   if(fatal){
     await db.query(`UPDATE run_budget_accounts SET blocked_reason='poll_errors_require_reconciliation',row_version=row_version+1 WHERE run_id=$1`,[job.runId]);
     await db.query(`INSERT INTO outbox_events(org_id,event_type,aggregate_id,payload) VALUES($1,'generation.poll_error_limit',$2,$3::jsonb)`,
       [job.orgId,job.id,JSON.stringify({runId:job.runId,jobId:job.id,errors})]);
   }
   return true;
 });
}

/** Record factual provider billed cost and immutable asset version in one transaction. */
export async function completeVideo(pool,job,asset,actualMinor){
 if(!Number.isSafeInteger(actualMinor)||actualMinor<0)throw new DomainError('INVALID_AMOUNT','Verified provider cost required');
 if(!/^[0-9a-f]{64}$/.test(asset?.sha256??'')||!Number.isSafeInteger(asset?.bytes)||asset.bytes<=0||!asset.storageKey)
   throw new DomainError('INVALID_ASSET','Verified media metadata required');
 return tx(pool,async db=>{
   const {rows:run}=await db.query(`SELECT id FROM production_runs WHERE id=$1 AND org_id=$2 FOR UPDATE`,[job.runId,job.orgId]);
   if(!run.length)throw new DomainError('NOT_FOUND','Run missing');
   const {rows:bs}=await db.query(`SELECT cap_minor,held_minor,confirmed_minor FROM run_budget_accounts WHERE run_id=$1 FOR UPDATE`,[job.runId]);
   const {rows:rs}=await db.query(`SELECT state,amount_minor,actual_minor FROM budget_reservations WHERE id=$1 FOR UPDATE`,[job.reservationId]);
   const {rows:js}=await db.query(`SELECT state FROM generation_jobs WHERE id=$1 FOR UPDATE`,[job.id]);
   if(js[0]?.state==='ready')return {replayed:true};
   if(js[0]?.state!=='polling'||rs[0]?.state!=='held')throw new DomainError('INVALID_STATE','Job/hold not eligible for completion');
   const predicted=BigInt(bs[0].confirmed_minor)+BigInt(bs[0].held_minor)-BigInt(rs[0].amount_minor)+BigInt(actualMinor);
   const overrun=predicted>BigInt(bs[0].cap_minor);
   await db.query(`INSERT INTO video_asset_versions(org_id,job_id,sha256,storage_key,bytes,width,height,duration_seconds)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[job.orgId,job.id,asset.sha256,asset.storageKey,asset.bytes,asset.width,asset.height,asset.durationSeconds]);
   await db.query(`UPDATE budget_reservations SET state='settled',submission_state='reconciled',actual_minor=$2,settled_at=now() WHERE id=$1`,[job.reservationId,actualMinor]);
   await db.query(`UPDATE run_budget_accounts SET held_minor=held_minor-$2,confirmed_minor=confirmed_minor+$3,
      blocked_reason=CASE WHEN $4 THEN 'provider_cost_overrun' ELSE blocked_reason END,row_version=row_version+1 WHERE run_id=$1`,
      [job.runId,rs[0].amount_minor,actualMinor,overrun]);
   await db.query(`INSERT INTO usage_ledger(run_id,reservation_id,entry_type,delta_held_minor,delta_confirmed_minor,actor_type,detail)
      VALUES($1,$2,'settle',$3,$4,'provider',$5::jsonb)`,[job.runId,job.reservationId,-BigInt(rs[0].amount_minor).toString(),actualMinor,JSON.stringify({overrun,assetSha256:asset.sha256})]);
   await db.query(`UPDATE generation_jobs SET state='ready',lease_expires_at=NULL,finished_at=now(),updated_at=now() WHERE id=$1`,[job.id]);
   await db.query(`INSERT INTO outbox_events(org_id,event_type,aggregate_id,payload) VALUES($1,'generation.asset_ready',$2,$3::jsonb)`,
      [job.orgId,job.id,JSON.stringify({runId:job.runId,jobId:job.id,assetSha256:asset.sha256,overrun})]);
   return {replayed:false,overrun};
 });
}

/** Provider may charge for failed jobs: DO NOT refund, release the hold or assume cost zero. */
export async function blockFailedProviderJob(pool,job){
 return tx(pool,async db=>{
   await db.query(`SELECT id FROM production_runs WHERE id=$1 AND org_id=$2 FOR UPDATE`,[job.runId,job.orgId]);
   await db.query(`SELECT run_id FROM run_budget_accounts WHERE run_id=$1 FOR UPDATE`,[job.runId]);
   const {rows}=await db.query(`UPDATE generation_jobs SET state='provider_failed_unsettled',error_code='PROVIDER_FAILED_BILLING_UNVERIFIED',
     lease_expires_at=NULL,updated_at=now() WHERE id=$1 AND state='polling' RETURNING id`,[job.id]);
   if(rows.length) {
     await db.query(`UPDATE run_budget_accounts SET blocked_reason='failed_job_billing_unknown',row_version=row_version+1 WHERE run_id=$1`,[job.runId]);
     await db.query(`INSERT INTO outbox_events(org_id,event_type,aggregate_id,payload) VALUES($1,'generation.billing_review_required',$2,$3::jsonb)`,
       [job.orgId,job.id,JSON.stringify({runId:job.runId,jobId:job.id})]);
   }
   return Boolean(rows.length);
 });
}

/** A crash mid-POST becomes quarantined, not another paid POST. */
export async function quarantineStaleSubmissions(pool,{ageSeconds=180}={}){
 const secs=Math.max(30,Math.min(86400,Math.round(ageSeconds)));
 const {rows}=await pool.query(`SELECT id,run_id,org_id,reservation_id FROM generation_jobs WHERE state='submitting'
   AND started_at < now() - ($1::integer * interval '1 second') LIMIT 100`,[secs]);
 let quarantined=0;
 for(const j of rows){
   try{const r=await markUnknown(pool,{id:j.id,runId:j.run_id,orgId:j.org_id,reservationId:j.reservation_id},'STALE_SUBMISSION');
      if(!r.replayed)quarantined++;}catch(e){if(e.code!=='INVALID_STATE')throw e;}
 }
 return quarantined;
}
