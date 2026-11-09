# CP-019 Local-First / Cloud-Compatible — Checklist Implementasi

**Status:** Approved architecture; **Phase 1 implemented; production release NOT approved**.
**Baseline UI:** CP-017 Clean Video. No new navigation section, provider or paid model enabled.
**Decision:** Each Windows laptop operates independently, and projects can be transferred. No real-time collaboration until VPS.

## P0 — Blocker sebelum Local Live dinyatakan operasional

| ID | Area | Bukti penerimaan | Status sekarang |
|---|---|---|---|
| P0-01 | UX CP-017 | Form kiri/hasil kanan; tombol generate jelas; tidak ada diagnosis teknis di layar operator | Partial: core Video UI dipertahankan, project copy dibersihkan; full ID/EN copy audit pending |
| P0-02 | Satu backend | UI memanggil API yang sama pada Local/VPS; tidak ada browser yang menyimpan secret | Partial: loopback API tersedia; adapter deployment VPS belum disiapkan |
| P0-03 | Workspace & identity | Identitas organization/workspace/project/user dan kontrol akses ditegakkan backend | Pending: operator-token lokal masih single-user, bukan RBAC SaaS |
| P0-04 | Project persistence | Project tersimpan setelah restart, tidak tertimpa secara diam-diam | Partial: local workspace JSON + atomic save; import dilindungi optimistic conflict hash |
| P0-05 | Job durability | Request provider idempotent, outbox/reservation atomik, status pulih setelah restart tanpa POST ulang | Pending: AIIDE video mempunyai intent lokal, belum transaction/outbox DB dan worker sepanjang hidup proses |
| P0-06 | Provider routing | Key AIIDE dapat dipakai pada model terizinkan dengan contract & capability check per service | Partial: AIIDE Video ada; Text/Image API belum live; TTS memerlukan verifikasi terpisah |
| P0-07 | Cost/quotas | Kuota user/project/workspace nyata, estimasi dan actual cost reconciled; refund/unknown states aman | Pending: local daily request cap bukan provider wallet/actual spend |
| P0-08 | Asset storage | Berkas asli tervalidasi, metadata versi, ownership, checksum, preview dan download sah | Partial: hasil MP4 dan TTS lokal sudah ada; belum menyatu dengan project ID dan storage portable |
| P0-09 | Backup & recovery | Restore ke perangkat baru teruji, termasuk media dan audit log, tanpa membocorkan API key | Partial: **creative plan JSON only** implemented; media/job migration belum tersedia |
| P0-10 | Local real end-to-end | Hasil sungguhan dengan API berizin diuji untuk tiap Studio yang ditandai live | Pending: pengujian mock tidak cukup |
| P0-11 | Security | Secret manager, CSRF, SSRF, file upload, permission, migration dan isolation smoke-test | Partial: pengujian baru untuk ekspor/impor. Pentest dan NTFS ACL tetap pending |

## P1 — Kesiapan pindah VPS tanpa rewrite

| Area | Kontrak target |
|---|---|
| Database | PostgreSQL schema/migrations sama di Local dan VPS, transaksi job/budget, unique constraints |
| Storage | Interface LocalFilesystem / S3-Compatible ObjectStorage; tidak ada path lokal langsung di UI |
| Background worker | Durable queue + lease + reconcile, proses terpisah dari browser |
| Auth | Local owner identity sama struktur role-nya dengan SaaS organization user; enforce scopes server-side |
| Secrets | Vault lokal di Windows; secret manager/env server di VPS; key tidak ikut backup project |
| Portable projects | Versioned manifest, checksum semua aset, explicit import conflict resolution, migration previews |
| Deploy | Single application modular monolith dengan konfigurasi environment, TLS reverse proxy, backups |
| Monitoring | Log kejadian terstruktur (tanpa credential), biaya per project, kesalahan tanpa raw provider payload ke operator |

## Per Section (tanpa menu baru)

| Section | Hasil yang dijanjikan | Siap Live? |
|---|---|---|
| Proyek & Cerita | Draft/saved story + export/import rencana | Lokal siap; media belum masuk paket ekspor |
| Storyboard & Karakter | Shot plan dari cerita, preview yang tidak mengaku AI final | Perencanaan lokal |
| Studio Gambar | Gambar asli dan download | Belum: adapter image live tidak terpasang |
| Buat Video AI | MP4 asli muncul otomatis dalam preview | Uji mock; AIIDE model/payload dan akun live masih perlu uji |
| Studio Gerak | I2V/reference video | Belum: secure reference staging dan provider capability diperlukan |
| Studio Suara | MP3 asli otomatis diputar/diunduh | Adapter ada; perlu key/entitlement dan paid live test berizin |
| Studio Film | Final MP4 hasil assembled shots | Belum: hanya fixture rendering |
| Alur Otomatis | Progress/hasi per tahap | Demo; perlu worker persisten dan project bindings |
| Persetujuan | Preview dan keputusan authorisasi | Belum multi-user production |
| Riwayat | Karya lintas Studio sesuai kepemilikan | Masih terpisah; perlu unified asset/job index |
| Kunci API | Admin-only secret management | Local vault ada, real RBAC SaaS belum ada |
| Panduan | Tutorial penggunaan dan ketentuan | UI draft ada; perlu review konten/legal |

**Syarat Go-Live per menu:** satu hasil real, video/gambar/audio benar-benar tersimpan, dapat diakses setelah restart, dan semua tes isolasi/biaya yang relevan lulus. Jangan label Live ketika hanya Draft/Fixture.

## Aturan biaya dan persetujuan

- CP-019 Phase 1 **tidak pernah memanggil provider berbayar**.
- Satu key AIIDE hanya dipakai untuk model yang diizinkan provider; Text/Image/Video tetap adapter berbeda.
- Jangan memutar key untuk melewati batas rate limit provider.
- Jangan otomatis mengulang request ketika status submit tidak pasti; lakukan reconciliation lebih dahulu.
- Jangan mengklaim biaya 0 bila belum ada billing terverifikasi; tampilkan "Belum ada laporan biaya terverifikasi".
- Merge ke `main` tetap dilarang tanpa approval pemilik.
