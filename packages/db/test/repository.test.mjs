import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve, dirname} from 'node:path';
import {DomainError} from '../../domain/src/index.mjs';
import {approvePlan,createProductionRun,reserveGenerationInternal,settleGenerationInternal,markSubmissionUnknownInternal} from '../src/index.mjs';
const code = s => err => err instanceof DomainError && err.code === s;
function fakePool(steps) {
  const calls=[]; let index=0; let released=false;
  const client={
    async query(sql,params=[]) {
      calls.push({sql:String(sql),params});
      if (['BEGIN','COMMIT','ROLLBACK'].includes(String(sql))) return {rows:[]};
      const step=steps[index++];
      if (!step) throw new Error(`Unexpected SQL: ${sql}`);
      assert.match(String(sql),step.sql);
      return {rows:step.rows??[]};
    },
    release(){released=true;}
  };
  return {calls, get released(){return released;},get remaining(){return steps.length-index;},async connect(){return client;}};
}
const step = (sql,rows=[]) => ({sql,rows});
const future='2099-12-01T00:00:00Z';
const approvedPlan = {id:'p',project_id:'proj',plan_hash:'a'.repeat(64),status:'approved',approved_by:'u-reviewer',quote_expires_at:future,reserve_cap_minor:'100',currency:'USD'};

test('CP002 migration includes immutable approvals, idempotency, budget and durable outbox',async()=>{
  const path=resolve(dirname(fileURLToPath(import.meta.url)),'../migrations/001_cp002_foundation.sql');
  const sql=await readFile(path,'utf8');
  for (const fragment of ['organization_memberships','production_plans','approval_decisions',
    'production_runs','run_budget_accounts','provider_capabilities','budget_reservations',
    'usage_ledger','api_idempotency_keys','outbox_events','approved_plan_immutable',
    'ledger_immutable']) assert.ok(sql.includes(fragment),`missing ${fragment}`);
});

test('CP002 plan approval requires membership and distinct human reviewer',async()=>{
  const pool=fakePool([
    step(/FROM organization_memberships/,[{role:'producer'}]),
    step(/FROM production_plans/,[{status:'draft',plan_hash:'h',created_by:'author',quote_expires_at:future}]),
    step(/UPDATE production_plans/),step(/INSERT INTO approval_decisions/)
  ]);
  const r=await approvePlan(pool,{orgId:'org',planId:'plan',actorId:'reviewer',expectedPlanHash:'h'});
  assert.equal(r.status,'approved');assert.equal(pool.remaining,0);
  assert.equal(pool.calls[0].sql,'BEGIN');assert.equal(pool.calls.at(-1).sql,'COMMIT');
});
test('CP002 cannot self-approve even with elevated role; transaction rolls back',async()=>{
  const pool=fakePool([
    step(/FROM organization_memberships/,[{role:'owner'}]),
    step(/FROM production_plans/,[{status:'draft',plan_hash:'h',created_by:'same',quote_expires_at:future}])
  ]);
  await assert.rejects(()=>approvePlan(pool,{orgId:'org',planId:'p',actorId:'same',expectedPlanHash:'h'}),code('APPROVAL_REQUIRED'));
  assert.equal(pool.calls.at(-1).sql,'ROLLBACK');
});
test('CP002 create run atomically writes account, idempotency and outbox',async()=>{
  const pool=fakePool([
    step(/FROM organization_memberships/,[{role:'producer'}]),
    step(/INSERT INTO api_idempotency_keys/,[{idem_key:'request1'}]),
    step(/FROM production_plans/,[approvedPlan]),
    step(/INSERT INTO production_runs/,[{id:'run'}]),
    step(/INSERT INTO run_budget_accounts/),
    step(/UPDATE api_idempotency_keys/),
    step(/INSERT INTO outbox_events/)
  ]);
  const r=await createProductionRun(pool,{orgId:'org',planId:'p',actorId:'producer',idemKey:'request1',expectedPlanHash:'a'.repeat(64)});
  assert.equal(r.runId,'run');assert.equal(r.replayed,false);assert.equal(pool.remaining,0);
  assert.deepEqual(pool.calls.map(x=>x.sql).slice(0,1),['BEGIN']);
  assert.equal(pool.calls.at(-1).sql,'COMMIT');
});
test('CP002 repeat idempotency key returns existing run without duplicate write',async()=>{
  const {hashSnapshot}=await import('../../domain/src/index.mjs');
  const request={orgId:'org',planId:'p',actorId:'user',idemKey:'same',expectedPlanHash:'hash'};
  const expected=hashSnapshot({orgId:request.orgId,planId:request.planId,actorId:request.actorId,expectedPlanHash:request.expectedPlanHash});
  const pool=fakePool([
    step(/FROM organization_memberships/,[{role:'producer'}]),
    step(/INSERT INTO api_idempotency_keys/),
    step(/SELECT request_hash,run_id FROM api_idempotency_keys/,[{request_hash:expected,run_id:'run1'}])
  ]);
  const r=await createProductionRun(pool,request);
  assert.equal(r.replayed,true);assert.equal(r.runId,'run1');assert.equal(pool.remaining,0);
  assert.ok(!pool.calls.some(x=>x.sql.includes('INSERT INTO production_runs')));
});
test('CP002 reject changed payload under same idempotency key',async()=>{
  const pool=fakePool([step(/FROM organization_memberships/,[{role:'producer'}]),
    step(/INSERT INTO api_idempotency_keys/),
    step(/SELECT request_hash,run_id FROM api_idempotency_keys/,[{request_hash:'not-current',run_id:'run1'}])]);
  await assert.rejects(()=>createProductionRun(pool,{orgId:'org',planId:'p',actorId:'a',idemKey:'k',expectedPlanHash:'h'}),code('IDEMPOTENCY_CONFLICT'));
  assert.equal(pool.calls.at(-1).sql,'ROLLBACK');
});
test('CP002 reserve generation enqueues intent AFTER budget hold, no external POST',async()=>{
  const pool=fakePool([
    step(/FROM production_runs r/,[{status:'scheduled',plan_hash:'h',current_plan_hash:'h',plan_status:'approved',approved_by:'reviewer',quote_expires_at:future}]),
    step(/FROM run_budget_accounts/,[{cap_minor:'100',held_minor:'20',confirmed_minor:'10',blocked_reason:null}]),
    step(/FROM budget_reservations/),
    step(/FROM provider_capabilities/,[{id:'cap',max_reserve_minor:'40'}]),
    step(/INSERT INTO budget_reservations/,[{id:'reservation-id'}]),
    step(/UPDATE run_budget_accounts/),
    step(/INSERT INTO usage_ledger/),
    step(/INSERT INTO outbox_events/)
  ]);
  const result=await reserveGenerationInternal(pool,{orgId:'org',runId:'run',reservationKey:'job1',nodeKey:'shot1',capabilityId:'cap',amountMinor:30});
  assert.equal(result.reservationId,'reservation-id');
  assert.equal(pool.calls.at(-1).sql,'COMMIT');
  assert.equal(pool.remaining,0);
});
test('CP002 reserve rejects expensive attempt and rolls back without ledger/event',async()=>{
  const pool=fakePool([
    step(/FROM production_runs r/,[{status:'running',plan_hash:'h',current_plan_hash:'h',plan_status:'approved',approved_by:'reviewer',quote_expires_at:future}]),
    step(/FROM run_budget_accounts/,[{cap_minor:'100',held_minor:'70',confirmed_minor:'20',blocked_reason:null}]),
    step(/FROM budget_reservations/),
    step(/FROM provider_capabilities/,[{id:'cap',max_reserve_minor:'100'}])
  ]);
  await assert.rejects(()=>reserveGenerationInternal(pool,{orgId:'org',runId:'run',reservationKey:'job1',nodeKey:'shot1',capabilityId:'cap',amountMinor:11}),code('RUN_BUDGET_EXCEEDED'));
  assert.equal(pool.calls.at(-1).sql,'ROLLBACK');
});
test('CP002 expired capability blocks paid reservation',async()=>{
  const pool=fakePool([
    step(/FROM production_runs r/,[{status:'running',plan_hash:'h',current_plan_hash:'h',plan_status:'approved',approved_by:'reviewer',quote_expires_at:future}]),
    step(/FROM run_budget_accounts/,[{cap_minor:'100',held_minor:'0',confirmed_minor:'0',blocked_reason:null}]),
    step(/FROM budget_reservations/),step(/FROM provider_capabilities/)
  ]);
  await assert.rejects(()=>reserveGenerationInternal(pool,{orgId:'org',runId:'run',reservationKey:'job1',nodeKey:'shot1',capabilityId:'cap',amountMinor:10}),code('CAPABILITY_UNVERIFIED'));
});
test('CP002 settlement records overrun, blocks budget, preserves real billed amount',async()=>{
  const pool=fakePool([
    step(/SELECT id FROM production_runs/,[{id:'run'}]),
    step(/FROM run_budget_accounts/,[{cap_minor:'100',held_minor:'80',confirmed_minor:'20'}]),
    step(/FROM budget_reservations/,[{id:'res',amount_minor:'80',state:'held'}]),
    step(/UPDATE budget_reservations/),
    step(/UPDATE run_budget_accounts/),
    step(/INSERT INTO usage_ledger/),step(/INSERT INTO outbox_events/)
  ]);
  const out=await settleGenerationInternal(pool,{orgId:'org',runId:'run',reservationKey:'job',actualMinor:120});
  assert.equal(out.overrun,true);
  const update=pool.calls.find(x=>x.sql.includes('UPDATE run_budget_accounts'));
  assert.equal(update.params[2],120);assert.equal(update.params[3],true);
  assert.equal(pool.calls.at(-1).sql,'COMMIT');
});
test('CP002 unknown submit outcome blocks further spending without repeat POST',async()=>{
  const pool=fakePool([
    step(/SELECT id FROM production_runs/,[{id:'run'}]),
    step(/FROM run_budget_accounts/,[{run_id:'run'}]),
    step(/FROM budget_reservations/,[{id:'reservation',state:'held',submission_state:'submitted'}]),
    step(/UPDATE budget_reservations/),step(/UPDATE run_budget_accounts/),
    step(/INSERT INTO outbox_events/)
  ]);
  const r=await markSubmissionUnknownInternal(pool,{orgId:'org',runId:'run',reservationKey:'job'});
  assert.equal(r.state,'unknown');assert.equal(pool.remaining,0);
});
