# CP028 · Aset lokal

Checkpoint lokal Dramasaku pada branch `codex/cp028-aset-lokal`, dari commit CP027 `156730d`.

1. Masuk ke studio lokal lalu buka **Aset**. Pilih satu atau beberapa gambar PNG, JPEG, WebP, klip MP4, atau audio MP3/WAV.
2. Periksa pratinjau dan waktu hapus pada kartu. **Lampirkan ke video** mengirim referensi yang didukung ke Buat Video. Ikon tempat sampah meminta konfirmasi sebelum menghapus file.
3. Masa simpan pustaka adalah 72 jam sejak setiap unggahan. Backend membersihkan file saat berjalan dan saat dinyalakan kembali. Berkas yang sedang dipakai untuk render diselesaikan setelah render melepas sumbernya. Jangka waktu berlaku juga untuk aset lama berdasarkan waktu unggah aslinya.
4. Penghapusan melepaskan review dan klip yang menggunakan aset tersebut. Draf video lokal masih dapat dibuka untuk mengganti lampiran. Ekspor paket tim memberi tahu jumlah draf dengan media hilang yang dilewati. Render akhir, paket yang telah diekspor, dan file sumber di luar pustaka memiliki penyimpanan tersendiri.

Pengujian lokal pada Node.js 22 menghasilkan 245 lulus, 0 gagal, dan 2 tes PostgreSQL dilewati. Tes browser memeriksa unggah beberapa format, pratinjau, lampiran video, batal hapus, hapus fisik, serta muat ulang. Timer berjalan dan pembersihan saat startup diuji dengan waktu unggah yang disimulasikan. Alur storyboard sampai render MP4 juga lulus. Panggilan generate berbayar saat tes berjumlah nol.
