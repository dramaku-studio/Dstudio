# Dramasaku Studio — Local Live Engine (CP-013)
Date: 2026-11-05 | Status: LOCAL PILOT / NO-GO PUBLIC PRODUCTION

## What changed
- CP-001–012 remain in one unified application.
- Fixed a contract mismatch between the local paid pilot and its provider adapter: the adapter needs server-derived capability verification, a durable local reservation identity, and a pinned request hash. Prior to this fix two baseline tests failed.
- Standardized Volcengine authorization header as `Bearer <key>` for the adapter. Actual account compatibility is NOT verified without approved live testing.
- Wired `/api/live/status`, `/api/live/submit`, `/api/live/jobs/:id/check`, `/api/live/jobs/:id/media` into the authenticated local console (loopback only, CSRF on mutations).
- Added a clearly labeled paid-test action in the unified Video Studio, hidden by default.
- Added local HTTP regression tests confirming no paid network calls occur when disabled or capability verification is absent.

## Test summary
Before changes: 111 total, 107 pass, 2 fail, 2 skipped (PostgreSQL).
After changes: 113 total, 111 pass, 0 fail, 2 skipped (PostgreSQL).
The passing suite uses mock/fake HTTP for provider calls; it does not prove the real Seedance endpoint works.

## Production decision
LOCAL DEVELOPMENT: GO. PUBLIC/PRODUCTION: NO-GO.
Blockers: PostgreSQL integration, real provider entitlement/capability/quote tests, exact billing, authentication for multiple users, cloud object storage, provider SLA/usage reconciliation, secure secret management, and full browser E2E.

## External integration status
GitHub: authenticated account accessible but no writable repository returned; no commit/push completed.
Google Drive: documents may be stored in the selected folder; source files contain no keys. Folder permissions must be restricted by owner before sensitive materials are stored.
