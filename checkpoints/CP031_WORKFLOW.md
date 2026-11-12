# CP031 · Workflow produksi lokal

Menu Alur Produksi memakai enam langkah Cerita, Target, Aset, Rencana, Review dan Final Prompt. Draf serta riwayat tersimpan per proyek di direktori privat lokal. Contoh romcom berisi 180 detik, 9:16, enam adegan dan 24 coverage.

## Yang terhubung

- Ekstraksi DOCX dan TXT. DOC lama memakai textutil pada macOS; perangkat lain menawarkan konversi DOCX atau tempel teks.
- Pengambilan naskah dari Proyek & Cerita secara eksplisit, target master, pilihan teknik visual dan catatan riset bersumber.
- Mapping lokal deterministik dan analisis teks AIIDE dengan pilihan model dari katalog akun serta persetujuan biaya.
- Pilihan kebutuhan aset, unggah/pilih master dan retensi master proyek sampai dihapus pengguna.
- Edit shot, durasi, lajur FULL/L/C/R dan waktu mulai. Timeline memeriksa celah serta overlap.
- Unggah/pilih storyboard, revisi, riwayat dan rollback terkonfirmasi.
- Rubrik pengguna, skor dengan bukti, Hard Goals dan approval versi. Perubahan input membatalkan QC atau approval.
- Usulan QC teks AIIDE. Pemeriksaan visual gambar dan gerak dilakukan reviewer.
- Prompt manual, ekspor draf dan pengiriman shot yang disetujui melalui engine AIIDE yang sudah ada. Polling, preview, unduh hasil dan pemulihan download memakai task yang sama. Token pengiriman mencegah klik ganda membuat task kedua.

## Verifikasi

260 tes lulus, 0 gagal. Dua tes PostgreSQL dilewati pada pengujian lokal. Chrome menguji enam layar, unggahan nyata, revisi setelah autosave/muat ulang, penerimaan teks dokumen, storyboard dan tampilan mobile. Tes HTTP memakai provider mock untuk jalur approval → dispatch → status → MP4 dan idempotensi. Ekstraksi DOC/DOCX juga diuji dengan file lokal.

Tidak ada request generasi berbayar dalam pengujian. Analisis teks dan QC AIIDE baru diuji melalui mock. Riset web otomatis dan generasi gambar storyboard belum dihubungkan. Rubrik sepuluh fundamental masih menunggu pemilik produksi. Skor saat ini memakai rata-rata berbobot sama dengan ambang 8,5. Ekspor draf menyertakan struktur teks; file master tersimpan terpisah.
