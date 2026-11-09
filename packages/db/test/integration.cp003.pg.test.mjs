import test from 'node:test';
import assert from 'node:assert/strict';
import {approvePlan,createProductionRun,reserveGenerationInternal} from '../src/index.mjs';
import {claimNextSubmit,markAccepted,markUnknown,claimNextPoll,completeVideo} from '../src/generation.mjs';
const live=process.env.DRAMASAKU_INTEGRATION_TEST==='1' && Boolean(process.env.DATABASE_URL);
test('PostgreSQL CP003: durable claim, idempotency, playable-asset metadata, settlement, ambiguous POST quarantine', {skip:!live},async()=>{
 const {default:pg}=await import('pg');const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:6});
 const one=async(sql,args=[]) => (await pool.query(sql,args)).rows[0];
 try{
   const org=(await one("INSERT INTO organizations(name) VALUES ('CP003 Integration') RETURNING id")).id;
   const creator=(await one('INSERT INTO app_users(external_subject) VALUES($1) RETURNING id',[`cp003-creator-${org}`])).id;
   const producer=(await one('INSERT INTO app_users(external_subject) VALUES($1) RETURNING id',[`cp003-producer-${org}`])).id;
   const reviewer=(await one('INSERT INTO app_users(external_subject) VALUES($1) RETURNING id',[`cp003-reviewer-${org}`])).id;
   await pool.query("INSERT INTO organization_memberships(org_id,user_id,role) VALUES($1,$2,'producer'),($1,$3,'producer'),($1,$4,'reviewer')",[org,creator,producer,reviewer]);
   const project=(await one("INSERT INTO projects(org_id,title) VALUES($1,'CP003') RETURNING id",[org])).id;
   const hash='a'.repeat(64);
   const plan=(await one(`INSERT INTO production_plans(org_id,project_id,version,story_version_id,skill_version_id,plan_hash,
     reserve_cap_minor,currency,quote_expires_at,created_by)
     VALUES($1,$2,1,gen_random_uuid(),gen_random_uuid(),$3,400,'USD',now()+interval '1 day',$4) RETURNING id`,[org,project,hash,creator])).id;
   await approvePlan(pool,{orgId:org,planId:plan,actorId:producer,expectedPlanHash:hash});
   const run=(await createProductionRun(pool,{orgId:org,planId:plan,actorId:producer,idemKey:'cp003run',expectedPlanHash:hash})).runId;
   const cap=(await one(`INSERT INTO provider_capabilities(org_id,provider_key,model_key,capability_version,
      max_reserve_minor,verified_by,verified_at,expires_at,enabled,evidence_ref)
      VALUES($1,'fixture','fixture-model','cp003',200,$2,now(),now()+interval '1 day',true,'test-fixture') RETURNING id`,[org,reviewer])).id;
   const params={orgId:org,runId:run,capabilityId:cap,amountMinor:100,nodeKey:'shot-001',reservationKey:'shot-001',generationInput:{prompt:'A test shot'}};
   const reserved=await reserveGenerationInternal(pool,params);assert.equal(reserved.replayed,false);
   const replay=await reserveGenerationInternal(pool,params);assert.equal(replay.replayed,true);
   await assert.rejects(()=>reserveGenerationInternal(pool,{...params,generationInput:{prompt:'changed prompt'}}),e=>e.code==='IDEMPOTENCY_CONFLICT');
   const claim=await claimNextSubmit(pool);assert.ok(claim);assert.equal(claim.reservationId,reserved.reservationId);
   const noSecond=await claimNextSubmit(pool);assert.equal(noSecond,null,'submitting job never requeued');
   await markAccepted(pool,claim,'fixture-test-1');
   const pending=await claimNextPoll(pool);assert.equal(pending.id,claim.id);
   const outcome=await completeVideo(pool,pending,{sha256:'b'.repeat(64),storageKey:'local-sha256://'+ 'b'.repeat(64),bytes:50000,width:480,height:854,durationSeconds:2},125);
   assert.equal(outcome.overrun,false);
   const metadata=await one('SELECT bytes,width,height FROM video_asset_versions WHERE job_id=$1',[claim.id]);
   assert.equal(Number(metadata.bytes),50000);assert.equal(metadata.width,480);
   const acct=await one('SELECT held_minor,confirmed_minor FROM run_budget_accounts WHERE run_id=$1',[run]);
   assert.equal(Number(acct.held_minor),0);assert.equal(Number(acct.confirmed_minor),125);
   await reserveGenerationInternal(pool,{...params,nodeKey:'shot-002',reservationKey:'shot-002',generationInput:{prompt:'A second test shot'}});
   const unknownJob=await claimNextSubmit(pool);assert.ok(unknownJob);
   await markUnknown(pool,unknownJob);
   assert.equal(await claimNextSubmit(pool),null);
   const freeze=await one('SELECT blocked_reason FROM run_budget_accounts WHERE run_id=$1',[run]);
   assert.equal(freeze.blocked_reason,'submission_unknown');
   const event=await one("SELECT count(*)::integer AS n FROM outbox_events WHERE aggregate_id=$1 AND event_type='generation.submission_unknown'",[unknownJob.reservationId]);
   assert.equal(event.n,1);
 }finally{await pool.end();}
});
