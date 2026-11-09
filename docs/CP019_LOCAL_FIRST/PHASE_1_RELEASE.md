# CP-019 — Phase 1 Code Checkpoint

## What changed

- Keep CP-017 Video Studio form, original Video Studio routes and automatic-result code unchanged.
- Clean visible operator-facing text in Project/Storyboard and header; avoid unverified numeric API cost display.
- Add **Ekspor Cerita / Impor Cerita** inside existing Project & Story page, no additional navigation.
- Add authenticated `/api/workspace/export` GET and CSRF-protected `/api/workspace/import` POST.
- Versioned checksum-validated transfer of creative project input only.
- Prevent overwriting unsaved/different versions with explicit replacement + current *input hash* check. Plan hash alone was insufficient because changing the title did not change the shot graph.
- Preserve `.local-private` secrets, AIIDE/TTS/video endpoints and all paid gates; no billable calls.

## Validation

- Baseline CP-017: 140 passed, 0 failed, 2 PostgreSQL skipped.
- Phase 1: 145 passed, 0 failed, 2 PostgreSQL skipped (includes five new tests).
- HTTP test checks unauthenticated access and CSRF rejection, export/import conflicts, no new paid calls.
- Browser E2E smoke **blocked** by sandbox browser navigation policy (`ERR_BLOCKED_BY_ADMINISTRATOR`) even though HTTP server responds; Windows user acceptance still required.

## Known blockers before declaring Local Live complete

- Full project/media portability, persistent worker queue, PostgreSQL source of truth, RBAC, verified AIIDE Text/Image and paid Seedance results, production billing/reconciliation, backup verification.
- The existing TTS and Video adapters have their own experimental read/submit gates; no claims of live media were made by this checkpoint.

**Release status: Local planning pilot, NOT full SaaS/production live.** No GitHub main merge and no provider charges.
