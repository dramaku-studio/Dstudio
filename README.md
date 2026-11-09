# Dramasaku Studio — CP022 AIIDE Model Plaza (0.8.0)

Untuk tim yang bekerja di komputer masing-masing dan bertukar berkas proyek.
Jalankan `npm run dev`, buka `http://127.0.0.1:4184`, lalu masukkan kode akses dari terminal sendiri. Node.js 22/24 dan FFmpeg + FFprobe di PATH diperlukan. Mode lokal tidak memerlukan npm install atau PostgreSQL.

Integrasi CP022 menambahkan enam model Dreamina/Seedance Mini/2.5, daftar model akun, dan pemindahan key yang belum digunakan ke kelompok Video. [Detail integrasi dan batas parameter](docs/CP022_AIIDE_MODEL_PLAZA.md).

Baca [MULAI_DI_SINI.txt](MULAI_DI_SINI.txt) untuk alur kerja, instalasi, upgrade, pemulihan cadangan, dan batas pemakaian.

- Video: 20 profil model AIIDE, pilihan mode per model, referensi berperan, validasi, draf lengkap, dan Uji Mode Lokal tanpa jaringan provider.
- Gambar/gerak/suara: draf tersimpan dan media lokal; generate gambar/TTS berbayar OFF.
- Persetujuan: review aset mengikuti versi cerita. Identitas peninjau adalah catatan operator lokal.
- Film: susun/trim gambar dan video, pilih audio, render MP4 dengan FFmpeg. Hasil adalah edit media lokal.
- Paket Tim: cerita, media, draf, susunan, dan review dapat dibuka di Dramasaku maupun Aragi. Kunci API dan alamat provider tidak ikut.
- Input key Video / AIIDE → pemeriksaan katalog otomatis → engine siap jika model didukung. Generate tetap memerlukan klik dan persetujuan biaya. Gunakan `STUDIO_OFFLINE=1` untuk mengunci generate. Baca [panduan CP021](docs/CP021_INSTALL.md).
- Video Extend tetap tidak tersedia karena kontrak AIIDE belum ditemukan. Profil request sesuai dokumentasi; hasil dan akses akun live belum diverifikasi.

Catatan checkpoint di bawah adalah riwayat versi lama dan tidak menggantikan panduan CP021.

---

> **CP-019 Phase 1 (Local-First / Cloud-Compatible):** See [technical checklist](docs/CP019_LOCAL_FIRST/TECHNICAL_CHECKLIST.md), [portable project guide](docs/CP019_LOCAL_FIRST/PORTABLE_PROJECT.md), and [release notes](docs/CP019_LOCAL_FIRST/PHASE_1_RELEASE.md). CP-017 Clean Video UI is preserved. This checkpoint adds project-plan portability only; provider live and SaaS readiness remain gated.

# DRAMASAKU STUDIO — CP-012 Unified Creative UI (CP-001 → CP-012)

**One local application:** `npm run dev` → `http://127.0.0.1:4184`. Node.js 22+ required. Use the one-time operator code shown by the startup script. This local dashboard is a pilot, **not** public production.

**New:** Clean creative-facing copy, Indonesian/English interface selector, Video prompt language ID/EN (draft metadata only), separate Help & Terms section, two encrypted multi-key groups for Creative AI (Text + Image) and Video AI (Seedance/other providers), provider-aware routing simulation, local daily request caps, per-key priority and round robin selection. No live billable request is possible from this console.

**Important:** Reusing the same provider secret across groups is blocked; vendor balance is **not** queried. API keys and usage counters live in `.local-private/` and are never packaged. Consult `checkpoints/CP-012.md` and `docs/CP012_RELEASE_SECURITY_AUDIT.md`. Local tests: 104 pass, 2 PostgreSQL skips (not live tested).

---

# DRAMASAKU STUDIO — CP-011 Unified UI (CP-001 → CP-010)

**Current default UI:** `npm run dev` or `npm run console:start` → `http://127.0.0.1:4184` (same Node.js operator app, one screen and one port). No dependencies required for this local mode. Use the operator token printed in the terminal.

Menu: Overview, Projects & Story, Storyboard & DNA, Image, Video Generate (Seedance CP-010 controls), Motion, Voice, Film & Render, Automation Workflow, Approvals, History, API & Credentials, Security & Live Gates.

Save a project locally, inspect its generated shot plan, transfer a shot prompt to Video Generate, or run a fixture production demo. The workflow demo reads the saved project **when starting a new plan**. **This is not yet a production deployment or real AI paid generation**. Source CP-001 Next.js scaffold remains for historical reference only and is not a second active UI.

See `checkpoints/CP-011-UNIFIED-UI.md` and `docs/CP011_UNIFIED_UI_SECURITY_AUDIT.md` for details, how to run, and constraints. Paid provider calls and publishing are disabled.

---

# Dramasaku Studio — unified CP-010 local engineering prototype

This repository is an **engineering starter + CP-002/CP-003 implementation**, NOT a finished, deployed, or production-ready autonomous video engine. Grounded in the user-supplied CP-001 source and the proposed Blueprint PRD v1.1.

## Requirements
- Node.js >=22, npm
- PostgreSQL 17 (Docker Compose config provided, not necessary for offline mock tests)
- Redis 7 for later CP-003 worker; not yet wired

## Offline verification (no packages or secrets required)

```bash
npm test       # 30 pass; 1 real-PostgreSQL test skipped without opt-in/env
npm run worker # CP-001 mock-only fixture; NO external calls
```

## Real PostgreSQL integration (development/test DB ONLY)

```bash
cp .env.example .env # edit values; do not commit
npm install
# set POSTGRES_PASSWORD and DATABASE_URL in your shell or dotenv-aware runner
docker compose -f infra/docker-compose.yml up -d
npm run db:migrate
DRAMASAKU_INTEGRATION_TEST=1 npm run test:integration
```

Important: shell commands do NOT automatically load `.env`; explicitly export the matching variables, or use a safe dotenv runner. Integration test creates records and must not be used on production database.

## CP-002 code
- `packages/db/migrations/001_cp002_foundation.sql` — tenant-aware schema, approved-plan immutability, append-only ledger/approval records, account+reservation/outbox entities.
- `packages/db/src/index.mjs` — transactional approval, idempotent run creation, budget reservation, settlement, and unknown submission handling (`pg.Pool` compatible).
- `packages/db/src/migrate.mjs` — SQL migration runner with checksum verification and PostgreSQL advisory lock.
- `packages/db/test/` — fast scripted-query unit tests plus opt-in PostgreSQL concurrency integration test.
- `.github/workflows/ci.yml` — CI workflow configured, **not executed here**.
- `packages/domain/src/index.mjs` — tighter DAG, snapshot, overrun, and export guards.
- `checkpoints/CP-002.md` — status, blockers and exact promotion gates.

## Security / ownership constraints
- Public API routes **must** derive actor/org context from a verified authenticated session. `actorId` and internal worker methods must never be exposed as untrusted inputs from the browser or n8n.
- Paid provider calls are **not implemented**. The outbox records an intent; no relay posts externally yet.
- `provider_capabilities` records must be verified, enabled, and non-expired before reservation. Do not auto-create fake verification records in production.
- All monetary values are stored as BIGINT minor units. No automatic refill, approval bypass, or blind external POST retry.
- No third-party API token belongs in this repository or UI. Set `PAID_GENERATION_ENABLED=false` until a reviewed provider integration is proven.

## Roadmap
- CP-002: persistence and transactional guards (**source implemented, real database test outstanding**)
- CP-003: authenticated API boundary, outbox/BullMQ, provider adapter and ingest
- CP-004: structured story/DNA and shot graph
- CP-005: QA, approvals, targeted regeneration
- CP-006: batch export pilot (R4)
- CP-007: automated finishing (separately approved R5)
- CP-008: distribution + n8n integration (separately approved R6)

See `checkpoints/CP-001.md` and `checkpoints/CP-002.md` for checkpoint history.

## CP-002 interactive offline preview (no npm install needed)

```bash
npm run preview
# Open http://127.0.0.1:4173 in your browser.
```

Preview serves a separate developer test bench (not the original Next.js build). Its API calls invoke actual `@dramasaku/domain` DAG, budget, QA and approval guard functions plus mock provider fixtures. You can validate the plan, approve it (simulated identity), run mock generation, review mock takes and export a mock JSON manifest. **No MP4, PostgreSQL, auth, paid API, or real publishing is provided.** The CP-001 Next scaffold is historical; `npm run dev` now runs the single canonical local UI.

## CP-003 implemented 2026-11-05 — local fixture (NOT AI generation)

CP-003 extends the starter with an offline-testable HTTP video-bridge adapter, streaming MP4 ingest and ffprobe validation, PostgreSQL generation job migration/state engine, no-blind-retry worker and staged risk review.

```bash
npm test                    # 45 pass, 2 PostgreSQL tests skipped without environment
npm run demo:video          # creates playable ffmpeg fixture at cp003-demo/index.html
npm run preview             # CP-002 interactive mock dashboard, loopback only
```

The **offline fixture makes a real playable MP4 with ffmpeg, not a paid AI video**. Browser demo is only local. `npm run worker:production` is guarded and deliberately disabled by default. It needs an approved provider-bridge service, PostgreSQL, credentials and reviewed persistent storage. It is NOT production ready.

See `checkpoints/CP-003.md`, `docs/CP003_LIVE_AUDIT.md`, `docs/PROVIDER_BRIDGE_CONTRACT.md` and `packages/db/migrations/002_cp003_generation_jobs.sql`.

**Status:** CP-003 source and local fixture verified; PostgreSQL migration/worker integration in CI pending; live/paid deploy NO-GO.


## CP004–008 local operator console (2026-11-05)

`npm run console:start` launches a **loopback-only** local dashboard, generates an operator token and encrypted vault master key once on the local machine, and displays the token in the terminal. Open `http://127.0.0.1:4184`, login, paste API credentials under **API & Credentials**. Saved credentials are **NOT used** for real vendor calls; the provider bridge is not connected to the dashboard, and paid generation is disabled.

Offline pipeline: story → locked DNA → shot DAG → QA reviewer fixture → manifest → FFmpeg fixture render → publish dry-run. See `RUN_CP004_CP008.md` and `docs/CP004_CP008_SECURITY_AUDIT.md`.

**Not live:** The original Next.js scaffold is still separate from this local operator console; database schema 003 is a draft until PostgreSQL integration tests pass. No hosted server or GitHub repository was deployed.


## CP-009 Seedance Studio

New **Video Generate Studio** is available in the local operator console. See `docs/CP009_SEEDANCE_RESEARCH_AND_SECURITY.md`. It can validate Seedance 2.x requests, store private attachments and prepare local drafts. **No paid generation is wired**, even if an API key is configured.


## CP-010 — Video Generate controls (integrated into this project)

The **same** local console (`npm run console:start`) contains both the production workflow and the Seedance Video Generate section. There is no second application/repository.

- Duration uses **1-second increments** from each model's published minimum to maximum: Seedance 2.0 / Fast / Mini `4–15s`; Seedance 2.5 `4–30s`. `Auto` is exposed where supported; 2.5 edit/extend require Auto. The provider does not offer 1–3 second native output in this registry.
- Aspect ratio includes the Seedance-native options **9:16, 16:9, 1:1, 4:3, 3:4, 21:9, Adaptive**, with common additional visual ratios **4:5, 5:4, 3:2, 2:3** shown disabled in Seedance's model selector rather than sending unsupported payloads. Future providers can support them after capability verification. Seedance 2.5 edit/extend and image-first modes force Adaptive as documented.
- Both controls are validated **server-side**, not merely by the UI. Actual model entitlement, billing and provider availability remain unverified. No billable calls are enabled.

See `checkpoints/CP-010.md` and `preview/seedance-studio-controls.html` for the offline controls preview.
