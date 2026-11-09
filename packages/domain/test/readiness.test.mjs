import test from 'node:test';import assert from 'node:assert/strict';
import {evaluateLiveReadiness,assertPaidDispatchAllowed} from '../src/readiness.mjs';
test('fails closed when readiness data is absent',()=>{const v=evaluateLiveReadiness();assert.equal(v.eligible,false);assert(v.blockers.includes('secretManager'));});
test('having a configured key alone does not allow paid generation',()=>assert.throws(()=>assertPaidDispatchAllowed({flags:{paidGenerationEnabled:true},gates:{configuredApiKey:true}}),e=>e.code==='LIVE_GATES_UNMET'));
test('must have all explicit gates and flag',()=>{const g=Object.fromEntries(evaluateLiveReadiness().blockers.map(x=>[x,true]));assert.equal(evaluateLiveReadiness(g).eligible,true);assert.throws(()=>assertPaidDispatchAllowed({gates:g}));assert.equal(assertPaidDispatchAllowed({gates:g,flags:{paidGenerationEnabled:true}}),true);});
