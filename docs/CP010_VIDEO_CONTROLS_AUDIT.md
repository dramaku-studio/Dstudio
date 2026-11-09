# CP-010 — Integrated Video Controls / Cross-check

## Scope and source
Previous checkpoint: CP-009 archive. One `dramasaku-studio` monorepo includes `apps/control-server`, production workflow mock/dry-run, security vault, providers registry, media library, worker and database migration files. No separate project created.

## UI changes
- Duration selector is generated from the active model capability, **one second at a time**.
- Seedance 2.0 / Fast / Mini: native `4–15` seconds. Seedance 2.5: `4–30` seconds. Auto is available where supported, and mandatory for 2.5 edit/extend.
- Aspect ratio selector supports native `9:16`, `16:9`, `1:1`, `4:3`, `3:4`, `21:9`, `adaptive`.
- Other common visual ratios (`4:5`, `5:4`, `3:2`, `2:3`) appear **disabled** for Seedance. They are **not** sent or silently mapped to an unsupported provider ratio. Future provider-specific capabilities can enable them.
- In 2.5 reference-first/last and edit/extend modes, UI forces `adaptive`; server enforces same. 2.0 edit/extend unnecessarily forced adaptive in CP-009, corrected.

## Cross-check result
Run `npm test` from repository root. At release packaging: **98 detected, 96 passed, 0 failed, 2 PostgreSQL integration tests skipped** because a real configured DB test environment is unavailable. Checks include provider-side integer validation, ratio allowlist, server HTTP tests and DOM-logic tests using the actual app.js functions in a controlled Node VM.

Additional source checks: `node --check` for `apps/control-server/app.js`, `packages/providers/src/seedance.mjs`, `apps/control-server/server.mjs` and the preview HTML's embedded JS.

## Known unverified risks
- Automated Chromium navigation to both local HTTP and offline file preview returned `ERR_BLOCKED_BY_ADMINISTRATOR` in this sandbox. **No browser E2E pass is claimed.** A static HTML preview is included for local manual inspection.
- Integration tests require PostgreSQL with migrations; no real data races or database recovery have been proven in this session.
- Model capability entries are conservative literature-based defaults and may differ by tenant, provider entitlement, region, or later API changes. Validate pricing, model IDs, quotas and available resolutions before any paid generation.
- API key storage is local dev encrypted vault only. It is not a production secret manager. Real paid generation and publishing remain disabled.
- Need separate approved work to activate public auth/RBAC, provider dispatch, media staging and production deployment.

## Official documentation used for supported ratios and duration
- https://docs.byteplus.com/en/docs/modelark/video-generation-tutorial?redirect=1
- https://docs.byteplus.com/en/docs/ModelArk/seedance-2-5

## Release decision
**GO for local review of UI and server draft validation. NO-GO for billable/public production.**
