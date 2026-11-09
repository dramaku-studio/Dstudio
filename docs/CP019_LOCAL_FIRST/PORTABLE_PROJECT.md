# Project Portability v1 — Perangkat Lokal

Dramasaku menyediakan ekspor/impor **rencana kreatif** melalui menu Proyek & Cerita. Format `dramasaku-proyek.json` adalah `kind=dramasaku.creative-project`, `version=1`, `scope=creative-plan-only`.

## Memindahkan proyek antar laptop

1. Laptop A: buka Proyek & Cerita, klik **Simpan Proyek**, lalu **Ekspor Cerita**.
2. Simpan JSON di lokasi pribadi terpercaya. Naskah/karakter masih **terbaca dalam file**, bukan terenkripsi.
3. Laptop B: jalankan Dramasaku CP-019, buka Proyek & Cerita, klik **Impor Cerita** dan pilih file JSON.
4. Jika laptop B sudah punya project, aplikasi meminta konfirmasi penggantian. Bila project berubah sementara itu, impor ditolak; muat ulang dahulu.
5. Setelah impor, periksa cerita dan storyboard. Riwayat media tidak ikut dipindahkan.

## Cakupan dan batas

**Berisi:** judul, naskah, gaya visual, karakter, jumlah dan durasi shot, checksum input dan hash plan.

**Tidak berisi:** API key, token operator, saldo/kuota provider, ID/kredensial job, catatan approval, gambar, audio, atau MP4. Ekspor ini belum merupakan **full project backup**. File dapat disalin ke perangkat lain tanpa menyertakan secret, tetapi data ceritanya sensitif dan harus disimpan privat.

**Integritas:** SHA-256 mendeteksi perubahan yang tidak sesuai terhadap input dan rencana; ini **bukan tanda tangan digital atau autentikasi sumber**. Impor selalu melalui validasi schema dan compiler yang sama dengan pembuatan proyek lokal.

**Belum bisa:** proyek bersamaan atau sinkronisasi waktu nyata. Untuk pindah ke VPS nanti, upgrade migrasi harus mencakup aset/jalannya job, schema dan pemetaan identitas pengguna. Jangan menyalin `.local-private` sembarangan; secret perlu dikonfigurasi aman pada masing-masing perangkat.
