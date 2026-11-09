# CP-003 pre-live cross-check — 5 November 2026

Scope: source CP-002 + CP-003 changes, offline fixture HTTP provider, local disk media store, PostgreSQL migration **review only**. No public deployment, paid API account, real provider, PostgreSQL server, n8n account, S3 bucket or authenticated web UI was available here. Passing local tests does NOT mean live safe.

## Results
- `npm test`: **45 passing, 0 failing, 2 skipped** (the skipped tests need live PostgreSQL).
- `npm run demo:video`: pass; local HTTP bridge returns a valid, playable 480×854, 2-second MP4 built by ffmpeg, ingested with ffprobe and SHA-256. NOT AI-generated.
- Real-DB concurrency, schema execution, multi-process races, paid-provider callbacks/prices, distributed storage durability, and actual hosting exposure: **UNVERIFIED**.

## P0 blockers to clear before public/paid production
1. **Authentication / authorization:** no production auth boundary in CP-003; private repository methods must NEVER be directly callable by user-controlled HTTP; membership checks and signed approvals needed for any public API route. API credentials in a secret manager.
2. **Storage durability:** local content-addressed media store is ONLY for single-machine dev; implement immutable private S3-compatible object storage, checksums, replication, retention, authenticated signed downloads, restore test.
3. **Provider API behavior:** generic video-bridge contract implemented, but NO verified direct vendor adapter or capability spike, price quote, invoice reconciliation, rate limit, policy validation or legal entitlement. Real paid endpoint intentionally disabled by default.
4. **Real PostgreSQL test / migrations:** run CI with PostgreSQL 17, verify migration 002 and concurrent submit/recovery/settlement. Enable `DRAMASAKU_INTEGRATION_TEST=1`; never run integration seed against prod DB.
5. **Workflow / input lineage:** CP-003 does not prove that `node_key`, prompt, dialogue, and referenced media match immutable approved Story/DNA/Shot versions. Typed node graph and approved snapshot validation are CP-004 critical gates.
6. **Dispatch ceilings:** per-organization, per-day and provider concurrency/rate/budget limits from Blueprint remain incomplete. Current run-level atomic cap is necessary but not sufficient.
7. **Real job/event engine:** CP-003 uses PostgreSQL polling of `generation_jobs`; BullMQ/Redis relays, dead-letter handling, alerting, metrics, distributed leases/HA and operations runbook still require implementation and testing.
8. **Media trust:** provider bridge domain must be owned/allowlisted, HTTPS, outbound firewall allowlist and DNS controls, video malware scan/moderation/rights review required for public exports; no arbitrary URL ingestion.
9. **Completion / approval:** an ingested asset is `ready` for QA, NOT `final_approved`, NOT a finished film, and NOT authorized for publishing. R4 QA and human review, R5 rendering, R6 publishing still pending.

## Bugs/risks resolved in source
| Risk | Mitigation implemented | Evidence |
| --- | --- | --- |
| Duplicate billing on ambiguous POST | Durable `submitting` claim; unknown or stale response quarantines job/run; NEVER resubmit automatically | worker tests and CP003 SQL |
| Unverified provider/mode dispatched after stale quote | Recheck active approved plan hash, quote expiry and capability at claim time | generation.mjs |
| Reservation previously released may still be posted | Recheck `held` + `reserved` under row lock before dispatch | generation.mjs |
| Race/deadlock potential between accept/reject/complete | Common run→budget→reservation→job locking order | generation.mjs |
| Provider follows attacker-controlled media URL or redirect | Fixed bridge origin/path; `redirect:'manual'`; safe task ID; no arbitrary output URL | bridge tests |
| Oversized/corrupt/unplayable MP4 stored | Max stream bytes; MIME; ftyp; ffprobe duration/dimensions; checksum; cleanup | media tests |
| Quota/charge lost on failed provider job | Leave hold, block new spending, require billing reconciliation | worker and SQL |
| Endless failed status polling | Bounded failure count; pause new expenditure and alert after five errors | generation.mjs |
| Public developer demo exposed as control API | Loopback-only preview server and cross-origin POST denial | preview/server.mjs |

## Release gates
**NO-GO** for live money/public: until all P0 items are verified in deployed staging. CP-003 is an implementation checkpoint/dry-run, not production certification. Do not claim autonomous AI visuals were created by the local fixture, or that live bug absence is proven.

Suggested staging acceptance tests: two workers race on a queued job; kill one after external POST, verify no duplicate paid POST; simulate invoice higher than reserve, new dispatch blocked; disable capability between reservation and claim; corrupt and oversize MP4; test unauthorized cross-tenant approval, signed URL expiry, provider outage, DB outage after accepted callback; backup/restore object store, and run security scan. Record screenshots, logs and cost receipts as release evidence.
