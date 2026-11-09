import {hashSnapshot, DomainError} from '../../domain/src/index.mjs';

function ensureId(x, label) {if (typeof x !== 'string' || !x.trim()) throw new DomainError('INVALID_REQUEST', `${label} required`);}
function ensureMinor(n, label) {if (!Number.isSafeInteger(n) || n < 0) throw new DomainError('INVALID_AMOUNT', `${label} must be nonnegative safe integer`);}
async function inTx(pool, action) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {await client.query('ROLLBACK'); throw err;}
  finally {client.release();}
}
async function membership(client, orgId, actorId, allowed) {
  const {rows} = await client.query(`SELECT role FROM organization_memberships
    WHERE org_id=$1 AND user_id=$2`, [orgId, actorId]);
  if (!allowed.includes(rows[0]?.role)) throw new DomainError('FORBIDDEN', 'Not authorized for this organization');
  return rows[0].role;
}

/** Called only with actorId obtained from a VERIFIED server-side session. */
export async function approvePlan(pool, {orgId, planId, actorId, expectedPlanHash, reason = null}) {
  for (const [name,value] of Object.entries({orgId,planId,actorId,expectedPlanHash})) ensureId(value,name);
  return inTx(pool, async (db) => {
    await membership(db, orgId, actorId, ['owner','admin','producer']);
    const {rows} = await db.query(`SELECT status,plan_hash,created_by,quote_expires_at
      FROM production_plans WHERE id=$1 AND org_id=$2 FOR UPDATE`, [planId,orgId]);
    const plan = rows[0];
    if (!plan) throw new DomainError('NOT_FOUND','Plan not found');
    if (plan.status !== 'draft') throw new DomainError('INVALID_STATE','Plan is not a draft');
    if (plan.plan_hash !== expectedPlanHash) throw new DomainError('PLAN_STALE','Plan hash changed');
    if (plan.created_by === actorId) throw new DomainError('APPROVAL_REQUIRED','Self approval prohibited');
    if (new Date(plan.quote_expires_at).getTime() <= Date.now()) throw new DomainError('PLAN_STALE','Quote expired');
    await db.query(`UPDATE production_plans SET status='approved',approved_by=$3,approved_at=now()
      WHERE id=$1 AND org_id=$2`, [planId,orgId,actorId]);
    await db.query(`INSERT INTO approval_decisions(org_id,plan_id,target_plan_hash,actor_id,decision,reason)
      VALUES ($1,$2,$3,$4,'approved',$5)`, [orgId,planId,expectedPlanHash,actorId,reason]);
    return {planId,planHash:expectedPlanHash,status:'approved'};
  });
}

/** Create exactly one run/budget account/outbox event per organization+idempotency key. */
export async function createProductionRun(pool, {orgId, planId, actorId, idemKey, expectedPlanHash}) {
  for (const [name,value] of Object.entries({orgId,planId,actorId,idemKey,expectedPlanHash})) ensureId(value,name);
  if (idemKey.length > 200) throw new DomainError('INVALID_REQUEST','Idempotency key too long');
  const requestHash = hashSnapshot({orgId,planId,actorId,expectedPlanHash});
  return inTx(pool, async (db) => {
    await membership(db,orgId,actorId,['owner','admin','producer']);
    const {rows: inserted} = await db.query(`INSERT INTO api_idempotency_keys(org_id,idem_key,request_hash)
      VALUES($1,$2,$3) ON CONFLICT(org_id,idem_key) DO NOTHING RETURNING idem_key`, [orgId,idemKey,requestHash]);
    if (!inserted.length) {
      const {rows:prior} = await db.query(`SELECT request_hash,run_id FROM api_idempotency_keys
        WHERE org_id=$1 AND idem_key=$2 FOR UPDATE`, [orgId,idemKey]);
      if (prior[0]?.request_hash !== requestHash) throw new DomainError('IDEMPOTENCY_CONFLICT','Same key with different request');
      if (!prior[0]?.run_id) throw new DomainError('INVALID_STATE','Unresolved idempotency record');
      return {runId:prior[0].run_id,replayed:true};
    }
    const {rows:plans} = await db.query(`SELECT id,project_id,plan_hash,status,approved_by,quote_expires_at,
      reserve_cap_minor,currency FROM production_plans WHERE id=$1 AND org_id=$2 FOR SHARE`, [planId,orgId]);
    const plan = plans[0];
    if (!plan) throw new DomainError('NOT_FOUND','Plan not found');
    if (plan.status !== 'approved' || !plan.approved_by) throw new DomainError('APPROVAL_REQUIRED','Plan must be approved');
    if (plan.plan_hash !== expectedPlanHash || new Date(plan.quote_expires_at).getTime() <= Date.now()) {
      throw new DomainError('PLAN_STALE','Plan approval/quote is stale');
    }
    const {rows:runs} = await db.query(`INSERT INTO production_runs(org_id,project_id,plan_id,plan_hash,status,requested_by)
      VALUES($1,$2,$3,$4,'scheduled',$5) RETURNING id`, [orgId,plan.project_id,planId,plan.plan_hash,actorId]);
    const runId = runs[0].id;
    await db.query(`INSERT INTO run_budget_accounts(run_id,org_id,cap_minor,currency)
      VALUES($1,$2,$3,$4)`, [runId,orgId,plan.reserve_cap_minor,plan.currency]);
    await db.query(`UPDATE api_idempotency_keys SET run_id=$3 WHERE org_id=$1 AND idem_key=$2`, [orgId,idemKey,runId]);
    await db.query(`INSERT INTO outbox_events(org_id,event_type,aggregate_id,payload)
      VALUES($1,'production_run.created',$2,$3::jsonb)`, [orgId,runId,JSON.stringify({runId,planId,planHash:plan.plan_hash})]);
    return {runId,replayed:false,status:'scheduled'};
  });
}

/** INTERNAL WORKER ONLY, never expose as a public endpoint.
 * Capability verification MUST be performed/stored by a privileged provider-spike process.
 * Durable outbox event is committed BEFORE any external paid POST can be attempted.
 */
export async function reserveGenerationInternal(pool, {orgId, runId, reservationKey, nodeKey, capabilityId, amountMinor, generationInput = null}) {
  for (const [name,value] of Object.entries({orgId,runId,reservationKey,nodeKey,capabilityId})) ensureId(value,name);
  ensureMinor(amountMinor,'amountMinor');
  if (amountMinor === 0) throw new DomainError('INVALID_AMOUNT','Billable reservation must be positive');
  if (generationInput !== null && (typeof generationInput?.prompt !== 'string' || !generationInput.prompt.trim() || generationInput.prompt.length > 4000)) {
    throw new DomainError('INVALID_PROMPT','Generation prompt must have 1-4000 characters');
  }
  const inputHash = generationInput === null ? null : hashSnapshot(generationInput);
  return inTx(pool, async (db) => {
    const {rows:runs} = await db.query(`SELECT r.status,r.plan_hash,p.plan_hash AS current_plan_hash,p.status AS plan_status,
      p.quote_expires_at,p.approved_by FROM production_runs r
      JOIN production_plans p ON p.id=r.plan_id AND p.org_id=r.org_id
      WHERE r.id=$1 AND r.org_id=$2 FOR UPDATE OF r`, [runId,orgId]);
    const run = runs[0];
    if (!run) throw new DomainError('NOT_FOUND','Run not found');
    // Always lock budget first: reservations, settlement and reconciliation share lock ordering.
    const {rows:budgets} = await db.query(`SELECT cap_minor,held_minor,confirmed_minor,blocked_reason FROM run_budget_accounts
      WHERE run_id=$1 AND org_id=$2 FOR UPDATE`, [runId,orgId]);
    const budget = budgets[0];
    if (!budget) throw new DomainError('INVALID_STATE','Run budget missing');
    const {rows:previous} = await db.query(`SELECT id,amount_minor,node_key,capability_id,state FROM budget_reservations
      WHERE run_id=$1 AND reservation_key=$2`, [runId,reservationKey]);
    if (previous.length) {
      const prior = previous[0];
      if (Number(prior.amount_minor) !== amountMinor || prior.node_key !== nodeKey || prior.capability_id !== capabilityId) {
        throw new DomainError('IDEMPOTENCY_CONFLICT','Reservation payload changed');
      }
      if (inputHash !== null) {
        const {rows:jobs}=await db.query(`SELECT input_hash FROM generation_jobs WHERE reservation_id=$1`,[prior.id]);
        if (jobs[0]?.input_hash !== inputHash) throw new DomainError('IDEMPOTENCY_CONFLICT','Generation input changed or missing');
      }
      return {reservationId:prior.id,replayed:true,state:prior.state};
    }
    if (!['scheduled','running'].includes(run.status)) throw new DomainError('RUN_PAUSED','Run cannot dispatch');
    if (run.plan_status !== 'approved' || !run.approved_by) throw new DomainError('APPROVAL_REQUIRED','Missing approved plan');
    if (run.plan_hash !== run.current_plan_hash || new Date(run.quote_expires_at).getTime() <= Date.now()) {
      throw new DomainError('PLAN_STALE','Pinned plan or quote stale');
    }
    if (budget.blocked_reason) throw new DomainError('RUN_BUDGET_EXCEEDED','Run budget blocked');
    const {rows:caps} = await db.query(`SELECT id,max_reserve_minor,provider_key,model_key FROM provider_capabilities
      WHERE id=$1 AND org_id=$2 AND enabled=true AND expires_at > now()`, [capabilityId,orgId]);
    if (!caps[0] || BigInt(amountMinor) > BigInt(caps[0].max_reserve_minor)) {
      throw new DomainError('CAPABILITY_UNVERIFIED','Verified and current provider capability required');
    }
    const available = BigInt(budget.cap_minor) - BigInt(budget.held_minor) - BigInt(budget.confirmed_minor);
    if (BigInt(amountMinor) > available) throw new DomainError('RUN_BUDGET_EXCEEDED','Insufficient run budget');
    const {rows:reservations} = await db.query(`INSERT INTO budget_reservations(run_id,reservation_key,node_key,capability_id,amount_minor)
      VALUES($1,$2,$3,$4,$5) RETURNING id`, [runId,reservationKey,nodeKey,capabilityId,amountMinor]);
    const reservationId = reservations[0].id;
    await db.query(`UPDATE run_budget_accounts SET held_minor=held_minor+$2,row_version=row_version+1
      WHERE run_id=$1`, [runId,amountMinor]);
    await db.query(`INSERT INTO usage_ledger(run_id,reservation_id,entry_type,delta_held_minor,actor_type)
      VALUES($1,$2,'hold',$3,'system')`, [runId,reservationId,amountMinor]);
    if (inputHash !== null) {
      await db.query(`INSERT INTO generation_jobs(org_id,run_id,reservation_id,node_key,provider_key,model_key,input_snapshot,input_hash)
        VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
        [orgId,runId,reservationId,nodeKey,caps[0].provider_key,caps[0].model_key,JSON.stringify(generationInput),inputHash]);
    }
    await db.query(`INSERT INTO outbox_events(org_id,event_type,aggregate_id,payload)
      VALUES($1,'generation.submit_requested',$2,$3::jsonb)`, [orgId,reservationId,JSON.stringify({runId,reservationId,nodeKey,capabilityId,queueReady:inputHash!==null})]);
    return {reservationId,replayed:false,state:'held'};
  });
}

/** Provider-confirmed bill may exceed quote; record factual cost, block new jobs, never silently truncate it. */
export async function settleGenerationInternal(pool, {orgId,runId,reservationKey,actualMinor}) {
  for (const [name,value] of Object.entries({orgId,runId,reservationKey})) ensureId(value,name);
  ensureMinor(actualMinor,'actualMinor');
  return inTx(pool, async (db) => {
    // Run lock before budget lock, same order as reservation.
    const {rows:runs} = await db.query(`SELECT id FROM production_runs WHERE id=$1 AND org_id=$2 FOR UPDATE`, [runId,orgId]);
    if (!runs.length) throw new DomainError('NOT_FOUND','Run not found');
    const {rows:budgets} = await db.query(`SELECT cap_minor,held_minor,confirmed_minor FROM run_budget_accounts
      WHERE run_id=$1 AND org_id=$2 FOR UPDATE`, [runId,orgId]);
    if (!budgets.length) throw new DomainError('INVALID_STATE','Run budget missing');
    const {rows:rs} = await db.query(`SELECT id,amount_minor,actual_minor,state FROM budget_reservations
      WHERE run_id=$1 AND reservation_key=$2 FOR UPDATE`, [runId,reservationKey]);
    const r = rs[0];
    if (!r) throw new DomainError('NOT_FOUND','Reservation not found');
    if (r.state === 'settled') {
      if (BigInt(r.actual_minor) !== BigInt(actualMinor)) throw new DomainError('IDEMPOTENCY_CONFLICT','Settlement changed');
      return {reservationId:r.id,replayed:true};
    }
    if (r.state !== 'held') throw new DomainError('INVALID_STATE','Reservation cannot settle');
    const predicted = BigInt(budgets[0].held_minor) - BigInt(r.amount_minor) + BigInt(budgets[0].confirmed_minor) + BigInt(actualMinor);
    const overrun = predicted > BigInt(budgets[0].cap_minor);
    await db.query(`UPDATE budget_reservations SET state='settled',actual_minor=$2,settled_at=now(),submission_state='reconciled'
      WHERE id=$1`, [r.id,actualMinor]);
    await db.query(`UPDATE run_budget_accounts SET held_minor=held_minor-$2,confirmed_minor=confirmed_minor+$3,
      blocked_reason=CASE WHEN $4 THEN 'provider_cost_overrun' ELSE blocked_reason END,
      row_version=row_version+1 WHERE run_id=$1`, [runId,r.amount_minor,actualMinor,overrun]);
    await db.query(`INSERT INTO usage_ledger(run_id,reservation_id,entry_type,delta_held_minor,delta_confirmed_minor,actor_type,detail)
      VALUES($1,$2,'settle',$3,$4,'provider',$5::jsonb)`, [runId,r.id,-BigInt(r.amount_minor).toString(),actualMinor,
      JSON.stringify({varianceMinor:(BigInt(actualMinor)-BigInt(r.amount_minor)).toString(),overrun})]);
    if (overrun) await db.query(`INSERT INTO outbox_events(org_id,event_type,aggregate_id,payload)
      VALUES($1,'run.budget_overrun',$2,$3::jsonb)`, [orgId,runId,JSON.stringify({runId,reservationKey})]);
    return {reservationId:r.id,replayed:false,overrun};
  });
}

/** Pause further expense when paid POST may have reached provider, pending manual reconciliation. */
export async function markSubmissionUnknownInternal(pool,{orgId,runId,reservationKey}) {
  for (const [name,value] of Object.entries({orgId,runId,reservationKey})) ensureId(value,name);
  return inTx(pool,async db => {
    const {rows:runs}=await db.query(`SELECT id FROM production_runs WHERE id=$1 AND org_id=$2 FOR UPDATE`,[runId,orgId]);
    if (!runs.length) throw new DomainError('NOT_FOUND','Run not found');
    await db.query(`SELECT run_id FROM run_budget_accounts WHERE run_id=$1 AND org_id=$2 FOR UPDATE`,[runId,orgId]);
    const {rows:rs}=await db.query(`SELECT id,state,submission_state FROM budget_reservations
      WHERE run_id=$1 AND reservation_key=$2 FOR UPDATE`,[runId,reservationKey]);
    if (!rs.length) throw new DomainError('NOT_FOUND','Reservation not found');
    if (rs[0].state !== 'held' || rs[0].submission_state === 'reconciled') {
      throw new DomainError('INVALID_STATE','Reconciled/settled generation cannot become unknown');
    }
    if (rs[0].submission_state !== 'unknown') {
      await db.query(`UPDATE budget_reservations SET submission_state='unknown' WHERE id=$1`,[rs[0].id]);
      await db.query(`UPDATE run_budget_accounts SET blocked_reason='submission_unknown',row_version=row_version+1 WHERE run_id=$1`,[runId]);
      await db.query(`INSERT INTO outbox_events(org_id,event_type,aggregate_id,payload)
        VALUES($1,'generation.submission_unknown',$2,$3::jsonb)`,[orgId,rs[0].id,JSON.stringify({runId,reservationKey})]);
    }
    return {reservationId:rs[0].id,state:'unknown'};
  });
}
