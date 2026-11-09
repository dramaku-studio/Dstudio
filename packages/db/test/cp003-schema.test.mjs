import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const sql=await readFile(new URL('../migrations/002_cp003_generation_jobs.sql',import.meta.url),'utf8');
test('CP003 queue has durable states, tenant FKs, unique task ID and asset version immutability',()=>{
 for(const term of ['submission_unknown','provider_failed_unsettled','external_task_id','uq_gen_provider_task',
 'FOREIGN KEY(run_id,org_id)','FOREIGN KEY(reservation_id,run_id)','CREATE TABLE video_asset_versions','video_asset_versions_immutable'])
   assert.ok(sql.includes(term),`Expected ${term}`);
});
