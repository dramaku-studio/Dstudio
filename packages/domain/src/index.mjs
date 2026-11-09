import {createHash} from 'node:crypto';
import {NODE_TYPES} from '../../contracts/src/index.mjs';

export class DomainError extends Error {
  constructor(code, message) {super(message); this.name = 'DomainError'; this.code = code;}
}
const requireNonnegativeSafeInt = (n, label) => {
  if (!Number.isSafeInteger(n) || n < 0) throw new DomainError('INVALID_AMOUNT', `${label} must be a nonnegative safe integer`);
};
function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new DomainError('INVALID_SNAPSHOT', 'Non-finite number');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new DomainError('INVALID_SNAPSHOT', 'Snapshot must use plain JSON objects');
  }
  return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonicalize(value[k])]));
}
export function hashSnapshot(value) {
  const json = JSON.stringify(canonicalize(value));
  if (typeof json !== 'string') throw new DomainError('INVALID_SNAPSHOT', 'Snapshot must be valid JSON');
  return createHash('sha256').update(json).digest('hex');
}

const KNOWN_NODE_TYPES = new Set(NODE_TYPES);
export function validateDag(nodes, edges) {
  if (!Array.isArray(nodes) || !Array.isArray(edges) || nodes.length === 0) throw new DomainError('DAG_INVALID', 'Graph must contain nodes');
  const ids = new Set();
  for (const n of nodes) {
    if (typeof n?.id !== 'string' || !n.id || !KNOWN_NODE_TYPES.has(n.type) || ids.has(n.id)) {
      throw new DomainError('DAG_INVALID', 'Invalid/duplicate node ID or unknown node type');
    }
    ids.add(n.id);
  }
  const next = new Map([...ids].map(id => [id, []]));
  const indegree = new Map([...ids].map(id => [id, 0]));
  const edgeSet = new Set();
  for (const edge of edges) {
    const {from, to} = edge ?? {};
    const key = JSON.stringify([from, to]);
    if (!ids.has(from) || !ids.has(to) || from === to || edgeSet.has(key)) throw new DomainError('DAG_INVALID', 'Invalid edge');
    edgeSet.add(key);
    next.get(from).push(to);
    indegree.set(to, indegree.get(to) + 1);
  }
  const ready = [...ids].filter(id => indegree.get(id) === 0);
  const order = [];
  while (ready.length) {
    const id = ready.shift();
    order.push(id);
    for (const target of next.get(id)) {
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) ready.push(target);
    }
  }
  if (order.length !== nodes.length) throw new DomainError('DAG_INVALID', 'Dependency cycle detected');
  return order;
}
export function affectedDownstream(changedId, edges) {
  const seen = new Set(); const pending = [changedId];
  while (pending.length) {
    const id = pending.shift();
    for (const edge of edges) if (edge.from === id && edge.to !== changedId && !seen.has(edge.to)) {
      seen.add(edge.to); pending.push(edge.to);
    }
  }
  return [...seen];
}

// Reference implementation ONLY. Paid execution must use PostgreSQL transactions in @dramasaku/db.
export class BudgetEnvelope {
  constructor(capMinor) {
    requireNonnegativeSafeInt(capMinor, 'capMinor');
    this.capMinor = capMinor; this.heldMinor = 0; this.confirmedMinor = 0;
    this.reservations = new Map(); this.blockedReason = null;
  }
  available() {return Math.max(0, this.capMinor - this.heldMinor - this.confirmedMinor);}
  hold(id, amount) {
    requireNonnegativeSafeInt(amount, 'amount');
    if (!id) throw new DomainError('INVALID_RESERVATION', 'Missing reservation id');
    const old = this.reservations.get(id);
    if (old) {
      if (old.amount !== amount) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Reservation payload changed');
      return old;
    }
    if (this.blockedReason) throw new DomainError('RUN_BUDGET_EXCEEDED', `Budget blocked: ${this.blockedReason}`);
    if (amount > this.available()) throw new DomainError('RUN_BUDGET_EXCEEDED', 'Insufficient approved run budget');
    const reservation = {id, amount, state: 'held'};
    this.reservations.set(id, reservation); this.heldMinor += amount; return reservation;
  }
  settle(id, amount) {
    requireNonnegativeSafeInt(amount, 'amount');
    const r = this.reservations.get(id);
    if (!r) throw new DomainError('NOT_FOUND', 'Reservation absent');
    if (r.state === 'settled') {
      if (r.actual !== amount) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Settlement payload changed');
      return r;
    }
    if (r.state !== 'held') throw new DomainError('INVALID_STATE', 'Reservation cannot settle');
    this.heldMinor -= r.amount; this.confirmedMinor += amount;
    r.state = 'settled'; r.actual = amount; r.variance = amount - r.amount;
    if (this.heldMinor + this.confirmedMinor > this.capMinor) this.blockedReason = 'provider_cost_overrun';
    return r;
  }
  release(id) {
    const r = this.reservations.get(id);
    if (!r) throw new DomainError('NOT_FOUND', 'Reservation absent');
    if (r.state === 'released') return r;
    if (r.state !== 'held') throw new DomainError('INVALID_STATE', 'Only held reservation may be released');
    this.heldMinor -= r.amount; r.state = 'released'; return r;
  }
}
export function canDispatch({runState, approvedPlanHash, currentPlanHash, approverId, budget, estimatedCostMinor, capabilityVerified}) {
  if (!['running', 'scheduled'].includes(runState)) throw new DomainError('RUN_PAUSED', 'Run is not dispatchable');
  if (!approvedPlanHash || !approverId) throw new DomainError('APPROVAL_REQUIRED', 'Human approval required');
  if (approvedPlanHash !== currentPlanHash) throw new DomainError('PLAN_STALE', 'Plan changed after approval');
  if (!capabilityVerified) throw new DomainError('CAPABILITY_UNVERIFIED', 'Provider capability not verified');
  requireNonnegativeSafeInt(estimatedCostMinor, 'estimatedCostMinor');
  if (budget?.blockedReason || estimatedCostMinor > budget?.available()) throw new DomainError('RUN_BUDGET_EXCEEDED', 'Budget insufficient/blocked');
  return true;
}
export function evaluateQuality({score, criticalFlags = []}) {
  if (!Number.isFinite(score) || score < 0 || score > 100) throw new DomainError('INVALID_SCORE', 'Score outside 0-100');
  if (criticalFlags.length) return 'needs_human';
  if (score < 60) return 'needs_revision';
  if (score < 85) return 'review_queue';
  return 'candidate_ready';
}
export function approveFinal({actorRole, actorId, creatorId, targetVersionId, criticalFlags = [], overrideReason, disableSelfApproval = true}) {
  if (!['admin', 'reviewer'].includes(actorRole) || !actorId || !targetVersionId) throw new DomainError('APPROVAL_REQUIRED', 'Reviewer/admin and version are required');
  if (disableSelfApproval && actorId === creatorId) throw new DomainError('APPROVAL_REQUIRED', 'Self approval forbidden');
  if (criticalFlags.length && !overrideReason) throw new DomainError('QUALITY_GATE_BLOCKED', 'Critical findings require documented exception');
  return {targetVersionId, actorId, decision: 'approved', reason: overrideReason ?? null};
}
export function canRegenerate({attempts, maxGenerations, remainingBudgetMinor, quotedCostMinor}) {
  requireNonnegativeSafeInt(attempts, 'attempts');
  requireNonnegativeSafeInt(maxGenerations, 'maxGenerations');
  requireNonnegativeSafeInt(quotedCostMinor, 'quotedCostMinor');
  if (attempts >= maxGenerations) throw new DomainError('SHOT_RETRY_LIMIT', 'Shot attempt limit reached');
  if (quotedCostMinor > remainingBudgetMinor) throw new DomainError('RUN_BUDGET_EXCEEDED', 'Insufficient budget');
  return true;
}
export function requireApprovedExport(takes, {expectedPlanHash, expectedSelectionHash, expectedAssetVersionsByShot} = {}) {
  if (!Array.isArray(takes) || !takes.length || takes.some(t => t.decision !== 'approved' || !t.assetVersionId)) {
    throw new DomainError('EXPORT_NOT_APPROVED', 'All exported takes must be approved and versioned');
  }
  if (expectedAssetVersionsByShot) {
    if (Object.keys(expectedAssetVersionsByShot).length !== takes.length ||
      takes.some(t => !t.shotId || expectedAssetVersionsByShot[t.shotId] !== t.assetVersionId)) {
      throw new DomainError('EXPORT_NOT_APPROVED', 'Export contains stale/mismatched take versions');
    }
  }
  if (expectedPlanHash && takes.some(t => t.planHash !== expectedPlanHash)) {
    throw new DomainError('EXPORT_NOT_APPROVED', 'Export plan version mismatch');
  }
  if (expectedSelectionHash && hashSnapshot(takes.map(t => [t.shotId, t.assetVersionId]).sort((a,b) => String(a[0]).localeCompare(String(b[0])))) !== expectedSelectionHash) {
    throw new DomainError('EXPORT_NOT_APPROVED', 'Export selection hash mismatch');
  }
  return takes.map(t => t.assetVersionId);
}
