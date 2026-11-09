import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
const sql=await readFile(new URL('../migrations/003_cp004_cp008_planning.sql',import.meta.url),'utf8');
test('CP004 schema includes typed DAG, immutable versions and publish idempotency',()=>{
 for(const table of ['story_versions','dna_versions','workflow_nodes','workflow_edges','shot_versions','quality_evaluations','take_approval_decisions','export_packages','render_jobs','publishing_jobs','provider_credential_refs'])assert.match(sql,new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
 assert.match(sql,/UNIQUE\(org_id,idempotency_hash\)/);assert.match(sql,/cp004_forbid_change/);
});
test('credential reference schema does not include plaintext key columns',()=>{const section=sql.split('CREATE TABLE IF NOT EXISTS provider_credential_refs (')[1].split(');')[0];assert(!/api_key|plaintext|secret_value/i.test(section));assert.match(section,/secret_ref/);});
