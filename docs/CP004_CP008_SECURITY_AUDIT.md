# CP004–008 cross-check and live vulnerability review — 2026-11-05

## Evidence and scope
Reviewed CP-003 input source plus implemented CP-004 deterministic screenplay parser, canonical DNA/shot DAG, prompt compiler; CP-005 take QA/revision/manifest contracts; CP-006 schema design; CP-007 FFmpeg fixture render; CP-008 publish **dry-run** contract; local operator dashboard with AES-256-GCM credential vault. Tests are local Node.js tests, plus one HTTP local-console and FFmpeg fixture integration. No actual paid provider endpoint, production identities, PostgreSQL database, cloud bucket, social account, internet deployment, or real money was used.

## Results
- `npm test`: see `checkpoints/CP-004-008-tests.tap`; all non-PostgreSQL tests pass; 2 PostgreSQL tests skipped without DB. Node.js 22 tested.
- HTTP operator console `/api/health`: startup and repeat startup pass; origin and CSRF refusals exercised; session cookie HttpOnly/SameSite Strict; no API secret displayed by `/api/keys`.
- Offline video fixture: ffmpeg playable MP4 around 6 seconds; same prerecorded FFmpeg fixture repeated. It is **not generative AI output**.
- Publishing: `preparePublishDryRun` records a mock envelope, outbound publish network calls = 0.
- Browser screenshot test in this isolated runtime not possible: Chromium file/localhost navigation was blocked by execution environment policy; manual browser UX verification remains pending.
- Source and tests updated after issues found; NO claim of security certification or penetration testing.

## Vulnerabilities mitigated in CP004-008
| Finding | Change | Evidence |
| --- | --- | --- |
| Missing human QA evidence for locked dialogue | `DIALOGUE_UNVERIFIED` flagged; reviewer exception requires meaningful reason in mock export | `creative.test.mjs` |
| Stale or duplicate take selection | Exact plan hash, all shot IDs, reviewer identity, approved versions and critical-flag exception validation | `finishing.mjs` tests |
| API key leak through browser or repo | Keys encrypted AES-256-GCM in `.local-private` (ignored), key never returned, metadata only | `vault.test.mjs` and HTTP console test |
| CSRF / cross-site requests to local dashboard | Origin/Host allowlist, CSRF header, HttpOnly SameSite=Strict session, loopback-only bind, CSP/no-store | `server.test.mjs` |
| Unapproved automatic paid generation after key saved | `paidCallsEnabled:false`, no vendor dispatch path, readiness fail-closed tests | `readiness.test.mjs` |
| Cross-org render/publish database relationships | Composite `(id,org_id)` FKs in SQL proposal | Static SQL schema test; **not DB executed** |
| Arbitrary media read / SSRF through dashboard | Only bundled fixture input, fixed render output path; no external URL input | code review + mock endpoint test |
| Unauthorized publishing release | Explicit final render approval requirement, dry-run only | `creative.test.mjs` |

## Known P0 blockers (public/paid production: **NO-GO**)
1. Production authentication, tenant-scoped authorization, service-to-service identity, immutable approval audit, RBAC and enforced separation of duties. The *local operator token* is never sufficient for internet-facing application.
2. PostgreSQL 17 integration migrations 001/002/003, concurrency, rollbacks, FK/tenant isolation and RLS evaluation. Integration tests require real database with safe fixtures and backup.
3. Managed secret store with per-org credential ACLs, rotatable versioned credentials, KMS/HSM/key rotation, deny-by-default audit. Encrypted local vault is dev-only; secrets not yet loaded into provider workers.
4. Real provider adapter(s): official endpoints, capability version, pricing and entitlements, quota/rate limits, TOS and consent, real idempotent submission and reconciliation of ambiguous chargeable requests. Explicit owner approval before paid testing.
5. Durable private S3-compatible asset storage + authenticated signed downloads, checksum, retention, malware/moderation/rights checks, recovery and backup restore tests.
6. Job orchestration persistence: PostgreSQL authoritative state + Redis/BullMQ retry safety + durable outbox + distributed leases, alerts, scheduled run recovery, kill switch, budget cap at org/project/run/shot/generation.
7. Quality evaluators: vision continuity, camera blocking, audio/transcript, rubric benchmarks, human reviewer UI with evidence. Current fixture QA is NOT measured cinematic quality.
8. R5 actual timeline/compositing, scene trim, audio mix, subtitles, license checks, final render QA and signoff. Current FFmpeg demo only repeats a prerecorded fixture.
9. R6 each platform's supported OAuth/permission/scopes, upload semantics, policies, publication ID reconciliation, post metadata/analytics and rate-limit handling. No live posting built or tested.
10. Public deployment security: TLS, firewall/egress allowlist, CSRF/session persistence design, webhook signatures, provider callback trust, monitoring/log redaction, backup, disaster recovery, load/abuse tests and dependency vulnerability scanning.

## Other issues (P1/P2)
- Screenplay grammar handles simple INT./EXT./SCENE headings; no robust multilingual screenplay parser, timing extraction or professional screenplay interchange.
- Provider slots only support 1 secret per function, not multi-provider/account and org management; future DB table stores secret reference only.
- Local session stored in memory; restarting server logs out users; no password reset or audit log.
- Vault is a local, process-scoped encrypted file, not a server cluster. Backup both key and vault securely; wrong key blocked by authenticated decrypt.
- Existing Next.js web scaffold does NOT yet embed the operator console; CP004–008 local console is a separate runnable prototype.
- SQL 003 is new draft extension, not part of the formally approved PRD v1.1; migrations cannot be treated as production safe before PostgreSQL staging tests.

## Required staging acceptance before live
1. Complete CP002/CP003 real database and provider spike; execute migrations 001-003 and reproduce AT19–AT32 against database-backed service.
2. Security tests: cross-tenant IDOR, no privilege escalation, session fixation/CSRF, key exfiltration/logging, SSRF redirects, replay/duplication and unauthorized approvals.
3. Race test two workers, kill process mid-POST and verify no blind retry or double-bill; settlement overrun freezes new dispatch.
4. Media S3 write/read/backup/restore, checksum and signed URL expiry; ffmpeg load test with real approved shot manifests.
5. Exact provider invoices and limits measured on a controlled budget; reviewer explicitly approves real video, audio and publication.
6. Verify social publishing permissions and idempotency per account/platform and actual posting in private staging accounts.
7. Collect test logs, provider receipts and signoff. No production enable flag without all gates met.

## Verdict
**CP004–008 OFFLINE PROTOTYPE: PASS** for checked local tests. **PRODUCTION LIVE: NO-GO**. This is a working development slice and secure-ish local credential entry, not end-to-end real production automation. Local console MUST stay bound to loopback. Ask owner before creating repositories, pushing code, deploying, or using paid credentials.
