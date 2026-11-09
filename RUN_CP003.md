# Jalankan Dramasaku Studio CP-003 (5 November 2026)

**Status: source/demo checkpoint, bukan AI production live.** Jalur video sudah diuji memakai video fixture 2 detik buatan FFmpeg, bukan model AI berbayar.

## Lihat sekarang tanpa install apa pun
Buka `examples/cp003-demo/index.html` di browser. Putar video fixture dan lihat manifest SHA-256. Dashboard mock CP-002 masih tersedia di `preview/index.html` dengan server Node.

## Jalankan pipeline fixture lokal
Perlu Node.js 22+, ffmpeg dan ffprobe.

```bash
npm test
npm run demo:video
```

Buka `cp003-demo/index.html` atau jalankan file MP4 hasil di `cp003-demo/private-assets`.

## Jalankan dashboard mock
```bash
npm run preview
# Browser: http://127.0.0.1:4173
```

## Jalankan PostgreSQL integration tests di staging
Perlu npm dependencies, Docker/PostgreSQL 17. Jangan jalankan seed testing di production.

```bash
npm install
# atur DATABASE_URL memakai akun database khusus testing
npm run db:migrate
DRAMASAKU_INTEGRATION_TEST=1 npm run test:integration
```

Worker asli `npm run worker:production` sengaja memiliki gate paid generation dan butuh bridge provider + server database + private storage yang memenuhi persyaratan. Belum aman dijalankan live/public, baca `docs/CP003_LIVE_AUDIT.md`.

## File penting
- `packages/db/migrations/002_cp003_generation_jobs.sql` — schema job durable
- `packages/db/src/generation.mjs` — worker DB state machine
- `apps/worker/production.mjs` — worker yang dapat dihubungkan ke database
- `packages/providers/src/http-video-bridge.mjs` — adapter provider generik, **bukan API vendor langsung**
- `packages/media/src/local-store.mjs` — store dev dan MP4 integrity checks
- `checkpoints/CP-003-test-output.tap` — output test yang benar-benar dijalankan
- `docs/CP003_LIVE_AUDIT.md` — bug review dan blocker sebelum live
