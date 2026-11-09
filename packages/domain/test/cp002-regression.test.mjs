import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDag,hashSnapshot,BudgetEnvelope,canDispatch,requireApprovedExport,DomainError} from '../src/index.mjs';
const code = name => err => err instanceof DomainError && err.code === name;
test('CP002 unknown DAG type rejected before paid work', () => {
  assert.throws(() => validateDag([{id:'fake', type:'UNRECOGNIZED'}],[]), code('DAG_INVALID'));
});
test('CP002 snapshot hash canonicalizes property order and nested structure', () => {
  assert.equal(hashSnapshot({a:1,b:{y:2,x:3}}),hashSnapshot({b:{x:3,y:2},a:1}));
  assert.notEqual(hashSnapshot([1,2]),hashSnapshot([2,1]));
});
test('CP002 overrun records actual amount and freezes fresh expense', () => {
  const b = new BudgetEnvelope(100);
  b.hold('first', 80); b.settle('first', 150);
  assert.equal(b.confirmedMinor,150);
  assert.equal(b.available(),0);
  assert.equal(b.blockedReason,'provider_cost_overrun');
  assert.throws(() => b.hold('second', 1), code('RUN_BUDGET_EXCEEDED'));
  assert.throws(() => canDispatch({runState:'running',approvedPlanHash:'p',currentPlanHash:'p',approverId:'reviewer',budget:b,estimatedCostMinor:1,capabilityVerified:true}), code('RUN_BUDGET_EXCEEDED'));
});
test('CP002 manifest rejects mismatched plan, shot asset or selection hash', () => {
  const takes = [{shotId:'s1',assetVersionId:'v1',planHash:'a',decision:'approved'}];
  assert.throws(() => requireApprovedExport(takes,{expectedPlanHash:'b'}),code('EXPORT_NOT_APPROVED'));
  assert.throws(() => requireApprovedExport(takes,{expectedAssetVersionsByShot:{s1:'v2'}}),code('EXPORT_NOT_APPROVED'));
  assert.throws(() => requireApprovedExport(takes,{expectedSelectionHash:'0'.repeat(64)}),code('EXPORT_NOT_APPROVED'));
  assert.deepEqual(requireApprovedExport(takes,{expectedPlanHash:'a',expectedAssetVersionsByShot:{s1:'v1'}}),['v1']);
});
