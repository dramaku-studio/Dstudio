# Dramasaku Studio CP-012 — Cross-Check & Release Security Audit

**Release decision: LOCAL PREVIEW GO / LIVE NO-GO.**

## Tests & evidence

- Node.js 22.16.0, `npm test`: **104 passed, 0 failed, 2 skipped PostgreSQL tests**, 106 discovered.
- Browser visual smoke test: Chromium in-memory rendered same app HTML/CSS/translation JS, and ID/EN key/help/video labels changed without page errors. Browser direct navigation to `127.0.0.1:4184` was blocked by environment policy, so real browser E2E still pending.
- HTTP backend tests: unauthorized 401, CSRF 403, foreign Origin 403, provider-aware preview, encrypted persistence (0600), API secrets never echoed, paid submit 404.
- Manual HTTP smoke: `/` and `/i18n.js` returned 200 on a loopback development server.

## Remediations

1. Removed engineering copy from standard UI; technical notes remain in repository docs only. Raw request details hidden from normal creatives, without removing server-side validation.
2. Added Indonesian/English interface translation and video draft prompt-language metadata; unsupported languages are rejected server-side. No auto prompt translation and no provider-invented `language` field.
3. Added guided help, privacy/consent information, and draft Terms & Conditions. Draft terms require legal/product-owner signoff.
4. Added separate Creative AI and Video AI key pools, provider-specific selection, local daily caps, priority/round-robin, disable/revoke; refused duplicate credential reuse within a provider.
5. Protected multi-key routes with existing loopback-only operator session, CSRF, and Origin/Host checks. Credential material is AES-256-GCM at rest, without UI readback.

## Remaining issues before production

| Severity | Blocker | Needed for signoff |
|---|---|---|
| BLOCKER | Real provider API submissions not integrated | User-approved API credential and provider contract; sandbox quote/generation; observed tasks & bills |
| BLOCKER | PostgreSQL concurrency tests skipped | Real isolated Postgres in CI/staging, transactional account/run budgets, outbox/reconciliation |
| BLOCKER | Local key quota state not distributed/account-wide | Tenant scoped DB reservations, multi-worker lock, provider/account balance reconciliation and rate-limit policies |
| BLOCKER | Local single-user operator auth | Production RBAC, sessions, secret manager/KMS, security review |
| BLOCKER | Upload assets local only | Encrypted object storage, signed upload/download, MIME verification, SSRF protections |
| HIGH | Model compatibility and pricing volatile | Versioned per-provider capability registry and quotes; no trusting screenshot discounts as API quotes |
| HIGH | UI translation coverage | Full locale review including runtime messages, accessibility and cross-browser E2E |
| HIGH | User-facing legal terms are draft | Product owner/legal signoff, published privacy and retention policies |
| MEDIUM | Vendor may enforce shared account quotas | Do not rotate secrets to evade provider limits; apply account/provider cap across keys |

## Multi-key design decision

- AIIDE can use one API credential for **compatible supported models**; this does not prove all video models use identical request endpoint or cost contract. Product should group keys by **provider AND workload** (creative vs video), not by model name alone. Each model references a verified provider adapter.
- Volcengine direct video API uses its own credential; key pool's `video + volcengine` route stays distinct from `video + aiide`.
- On local cap exhaustion, preview returns no eligible key. In production no blind failover for ambiguous paid submits. Switching keys should only happen before dispatch and only within provider authorization/rate policies.
- Manual `requests/day` quota estimates are not vendor balance. Dedicated cost caps in currency and verified provider usage will be required for paid release.

**No external writes**: No GitHub commits/push, no Drive upload, no provider API consumption, no public deployment. Do not paste live keys into this local prototype until production auth/secret-manager upgrade and deliberate test approval.
