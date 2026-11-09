import test from 'node:test';
import assert from 'node:assert/strict';
import {approvePlan,createProductionRun,reserveGenerationInternal,settleGenerationInternal} from '../src/index.mjs';

// Opt-in real integration; ordinary `npm test` never requires credentials, pg or PostgreSQL.
const run = process.env.DRAMASAKU_INTEGRATION_TEST === '1' && Boolean(process.env.DATABASE_URL);
test('PostgreSQL: transactional approval, idempotency, concurrent holds, overrun', {skip:!run}, async() => {
  const {default:pg} = await import('pg');
  const pool = new pg.Pool({connectionString:process.env.DATABASE_URL,max:8});
  try {
    const make = async(sql,params=[]) => (await pool.query(sql,params)).rows[0];
    const org = (await make("INSERT INTO organizations(name) VALUES('CP002 Integration') RETURNING id")).id;
    const creator = (await make("INSERT INTO app_users(external_subject) VALUES($1) RETURNING id",[`it-creator-${org}`])).id;
    const reviewer = (await make("INSERT INTO app_users(external_subject) VALUES($1) RETURNING id",[`it-reviewer-${org}`])).id;
    const producer = (await make("INSERT INTO app_users(external_subject) VALUES($1) RETURNING id",[`it-producer-${org}`])).id;
    await pool.query("INSERT INTO organization_memberships(org_id,user_id,role) VALUES($1,$2,'producer'),($1,$3,'reviewer'),($1,$4,'producer')",[org,creator,reviewer,producer]);
    const project=(await make('INSERT INTO projects(org_id,title) VALUES($1,$2) RETURNING id',[org,'A pilot project'])).id;
    const planHash='b'.repeat(64);
    const plan=(await make(`INSERT INTO production_plans(org_id,project_id,version,story_version_id,
      skill_version_id,plan_hash,reserve_cap_minor,currency,quote_expires_at,created_by)
      VALUES($1,$2,1,gen_random_uuid(),gen_random_uuid(),$3,100,'USD',now()+interval '1 day',$4) RETURNING id`,
      [org,project,planHash,creator])).id;
    const approved=await approvePlan(pool,{orgId:org,planId:plan,actorId:producer,expectedPlanHash:planHash});
    assert.equal(approved.status,'approved');
    await assert.rejects(()=>pool.query("UPDATE production_plans SET plan_hash=$2 WHERE id=$1",[plan,'c'.repeat(64)]));
    const first=await createProductionRun(pool,{orgId:org,planId:plan,actorId:producer,idemKey:'start1',expectedPlanHash:planHash});
    const duplicate=await createProductionRun(pool,{orgId:org,planId:plan,actorId:producer,idemKey:'start1',expectedPlanHash:planHash});
    assert.equal(first.runId,duplicate.runId);assert.equal(duplicate.replayed,true);
    const capability=(await make(`INSERT INTO provider_capabilities(org_id,provider_key,model_key,capability_version,
      max_reserve_minor,verified_by,verified_at,expires_at,enabled,evidence_ref)
      VALUES($1,'fixture','model','verified-1',100,$2,now(),now()+interval '1 day',true,'fixture-only') RETURNING id`,
      [org,reviewer])).id;
    const base={orgId:org,runId:first.runId,capabilityId:capability,amountMinor:70};
    const results=await Promise.allSettled([
      reserveGenerationInternal(pool,{...base,reservationKey:'shot1',nodeKey:'shot1'}),
      reserveGenerationInternal(pool,{...base,reservationKey:'shot2',nodeKey:'shot2'})
    ]);
    const success=results.filter(x=>x.status==='fulfilled');
    const failure=results.filter(x=>x.status==='rejected');
    assert.equal(success.length,1,'only one 70/100 hold is possible');
    assert.equal(failure.length,1);
    assert.equal(failure[0].reason.code,'RUN_BUDGET_EXCEEDED');
    const key=results[0].status==='fulfilled'?'shot1':'shot2';
    const settlement=await settleGenerationInternal(pool,{orgId:org,runId:first.runId,reservationKey:key,actualMinor:120});
    assert.equal(settlement.overrun,true);
    const account=(await make('SELECT held_minor,confirmed_minor,blocked_reason FROM run_budget_accounts WHERE run_id=$1',[first.runId]));
    assert.equal(Number(account.confirmed_minor),120);
    assert.equal(account.blocked_reason,'provider_cost_overrun');
    const count=await make('SELECT count(*)::integer AS n FROM outbox_events WHERE aggregate_id=$1',[first.runId]);
    assert.equal(count.n,2,'run.created plus budget-overrun event');
    await assert.rejects(()=>reserveGenerationInternal(pool,{...base,amountMinor:1,reservationKey:'shot3',nodeKey:'shot3'}),e=>e.code==='RUN_BUDGET_EXCEEDED');
  } finally {await pool.end();}
});
