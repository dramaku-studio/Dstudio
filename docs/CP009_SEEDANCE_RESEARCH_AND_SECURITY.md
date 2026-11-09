# CP-009 — Seedance Video Generation Studio

Status: **local development prototype, paid submission disabled.** Last reviewed: 2026-11-05.

## Source-of-truth distinction

The owner's Google Drive reference folder contains screenshots (UGC Maker and RCS dashboard). It provides UI inspiration: a video sidebar, model selector, generation prompt, aspect/duration controls, optional image, asset library, preview, output history, and storyboard-to-film handoff. The screenshots **do not define the vendor API**. Dramasaku uses its own BoardUI palette and does not copy external source code.

The vendor capability reference is sourced separately from:
- Volcengine LAS operator documentation: https://docs.volcengine.com/docs/lake-ai-service/video-generation-enhanced-edition-basic-edition?lang=en
- BytePlus ModelArk video generation tutorial: https://docs.byteplus.com/id/docs/modelark/video-generation-tutorial
- Volcengine Seedance matrix: https://docs.volcengine.com/docs/ark/seedance-2-5?lang=en

Model/catalog defaults in this prototype are conservative, **not proof of API entitlement**, quote validity, or guaranteed support for a customer account. Do not merge ModelArk and LAS base URLs or API key formats without explicit tests per account.

## UI features in this checkpoint

`Video Generate Studio` includes:
- Model selector: Seedance 2.0 / 2.0 Fast / 2.0 Mini / 2.5.
- Modes: Text-to-Video; Image-to-Video (first frame); First & Last Frame; multimodal Reference; Edit; Extend.
- Settings: creative prompt, aspect ratio, duration, resolution, audio flag, watermark, optional seed, model-specific draft toggle.
- Private local media library upload: PNG/JPEG/WebP/MP4/MP3/WAV with file signature check, size limit, per-role selection, SHA-256 tracking.
- Backend capability gate and compiled JSON request inspector.
- Persisted local generation drafts (explicitly **not** submitted to provider), and list of drafts.
- Separate `volcengine_las` credential slot using existing AES-256-GCM development vault.

## API contract (loopback operator only)

```
GET  /api/seedance/catalog                  requires login
GET  /api/seedance/assets                   requires login
POST /api/seedance/assets                   CSRF, octet-stream, x-asset-name percent-encoded
GET  /api/seedance/assets/{id}/media        requires login
POST /api/seedance/preview                  CSRF; validate/compile, no paid submission
POST /api/seedance/jobs                     CSRF; prepare local draft only
GET  /api/seedance/jobs                     requires login
```

Local stores are under `.local-private/seedance-assets` and are excluded from packaged source. Media is *not* made publicly accessible. Preview payloads with references contain `LOCAL_ASSET_NOT_STAGED:{id}`, intentionally NOT a usable provider URL. No endpoint has an `enableLive`, `testPaid`, or `submitBillable` action.

A provider adapter file exists (`packages/providers/src/seedance-las-adapter.mjs`) and has mock-transport unit tests. **It is not connected to the operator HTTP server**. Its network flag defaults off, requires a server-issued approval/budget permit, rejects local reference URLs, and treats any ambiguous POST as unknown rather than retrying. It is a SPIKE, not a production integration.

## Conservative capability matrix

| Model | Max output duration | Resolutions exposed | Reference images | Video refs | Audio refs | Notes |
|---|---:|---|---:|---:|---:|---|
| Seedance 2.0 | 15s | 480p / 720p / 1080p (T2V only for 1080p) | 9 | 3 | disabled pending verification | Other vendor-specific options withheld |
| Seedance 2.0 Fast | 15s | 480p / 720p | 9 | 3 | disabled pending verification | Reduced set |
| Seedance 2.0 Mini | 15s | 480p / 720p | 9 | 3 | disabled pending verification | Reduced set |
| Seedance 2.5 | 30s | 480p / 720p / 1080p (T2V only for 1080p) | 30 | 3 | 3 | Draft at 480p; edit/extend uses auto duration |

**Restrictions are conservative prototype choices**, not the provider's complete feature ceiling. For example, official materials describe broader multimodal references and some 4K support, which is withheld until a capability spike.

## Unresolved live blockers (NO-GO)

1. Tenant-scoped auth/RBAC and secret manager; local login/vault is not suitable for internet deployment. Browser cannot reveal keys, but owner must supply and manage credentials out-of-band.
2. Provider entitlement, endpoint/region, signed auth format, quotas, live status callback, pricing/quotes, billable reserve, and response formats must be checked on the account.
3. Production media staging: private S3-compatible store; short-lived signed URLs with sufficient TTL or approved asset-ID path; SSRF defenses; MIME/content inspection with full media decode, antivirus where appropriate; consent and retention.
4. PostgreSQL integration tests in previous checkpoints still skipped. Atomic ledger/outbox and real long-running worker must be proven before paying for generation.
5. Server-side idempotency, reconciliation of `submission_unknown`, provider polling, asset ingestion, quotas and dispatch gates must be integrated end-to-end with production DAG. The standalone LAS adapter is a stub, not proof of that integration.
6. Final video QA, signed human approval, and publishing OAuth are not part of this section.

## Security cross-check

- Only listens at `127.0.0.1`/`::1` with session, CSRF and Origin checks.
- New APIs do not reveal credentials or allow billable calls.
- Validates model, mode, ratio, duration, reference roles and local asset ownership server-side.
- Private upload validates magic bytes and limits per-file sizes / total count / storage quota. **Full content decoding/virus checks are not implemented** — do not expose uploads to public traffic.
- Original file name is sanitized; server generates random asset ID; path is not user-controlled.
- Output plan clearly labels local asset references as not staged.
- Local draft storage persists metadata, not credential strings; may contain creative prompt and should be handled as private project data.
- Media output may not be displayed inline if a generic browser blocks `file://` or unsupported local media codecs; use the runnable console.
- No real provider API calls or pricing validation performed.

## Startup & test

From repo root:

```
npm test
npm run console:start
```

Then open `http://127.0.0.1:4184` **on that same computer**; paste local operator token printed by the startup script, open Video Generate Studio, upload attachments, set their roles, validate, prepare draft. For encrypted provider key use API & Credentials → Seedance / Volcengine LAS. Saving key does not activate provider.
