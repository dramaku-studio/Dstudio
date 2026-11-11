# AIIDE: input key dan kesiapan video lokal

Jalankan `npm run dev` dan buka http://127.0.0.1:4184. Masuk dengan password tim (awal `654321`). Di Kunci API, tempel key. Pilih AIIDE untuk key generik. Studio memeriksa katalog melalui backend lokal. Ikuti langkah Uji Mode Lokal sebelum generate.

## Contoh request yang diberikan pengguna (10 November 2026)

Empat model video memakai POST `https://api.aiide.com/v1/video/generations`:
- `dreamina-seedance-2-5-hc`
- `dreamina-seedance-2-0-hc`
- `dreamina-seedance-2-0-mini-hc`
- `doubao-seedance-2-5-260628`

Body: model, prompt, metadata.content berisi image_url dan role reference_image; metadata.generate_audio=true, ratio=16:9, duration=5, resolution=480p, watermark=false. Profil compiler dan fixture mock sudah mencocokkan struktur ini. Polling dan hasil nyata masih memerlukan pengujian live terpisah.

Contoh DeepSeek `deepseek-v4-pro` memakai POST `https://www.aiide.com/v1/chat/completions` dengan messages. Contoh Claude memakai endpoint chat di api.aiide.com. Keduanya layanan teks; belum dihubungkan ke alur video atau dijalankan dalam perubahan ini.

Tidak ada key asli disimpan dalam source atau dokumen ini. Key asli harus dimasukkan langsung ke UI lokal.

## Lampiran video (penyesuaian lokal 10 November 2026)

- Pemilihan gambar/MP3 otomatis melampirkan file; video MP4 memakai kolom terpisah. Tag @image1, @audio1, @video1 mengikuti urutan per jenis dalam request. Klik tag untuk memasukkan ke prompt. Tombol × melepas lampiran dan menyesuaikan tag di prompt; file tetap tersimpan di pustaka lokal.
- Audio: MP3, total maksimal 30 detik dan 5 MiB. Video: maksimal 5 MiB/file dan plafon studio 30 detik. Batas model yang lebih rendah tetap berlaku (profil Seedance/Sora saat ini total video 15 detik; Seedance maksimal 9 gambar, 3 audio, 3 video).
- Durasi keluaran menggunakan slider langkah 1 detik, dipotong ke rentang model yang terverifikasi. Model berprofil tetap 5 detik memiliki slider terkunci; keberhasilan GET katalog tidak mengubah limit.
- FFprobe memeriksa media lokal; startup macOS mencari juga lokasi Homebrew dan CapCut jika tersedia. Windows tetap memerlukan FFmpeg/FFprobe pada PATH. File tidak valid tetap ditolak.
- Pilihan pengguna: gunakan URL publik aset yang sudah tersedia. Setiap file lokal dipasangkan dengan URL aset yang sama; tidak ada upload ke hosting baru. URL disimpan ketika kolom kehilangan fokus. Kesesuaian isi URL dengan file lokal belum diverifikasi otomatis.
- Alat tes dan draf tersedia dalam bagian yang bisa dibuka; Generate adalah aksi utama, tetap meminta konfirmasi biaya.
- Endpoint asset AIIDE yang ditinjau menerima URL publik, bukan file localhost: https://aiide.apifox.cn/english/9241613m0 . Tag UI bukan bukti kepatuhan model terhadap tag; hasil nyata belum diuji.
- Regresi: 242 lulus, 0 gagal, 2 PostgreSQL dilewati. Browser mock: unggah otomatis, tag/remap setelah hapus, penolakan total audio >30 detik, kolom video, URL binding, slider batas model dan lebar mobile lulus. Tidak ada request generate nyata.

## Alur tim di studio lokal

Referensi antarmuka mencakup perpindahan dari storyboard ke studio produksi di [Robotsakti](https://robotsakti.com/dashboard), serta editor prompt, lampiran, dan kontrol per model di [Studio Gambar](https://bumi.digital/dashboard/create/image) dan [Studio Video Bumi Digital](https://bumi.digital/dashboard/create/video). Batas yang ditampilkan di studio mengikuti profil AIIDE pada model terpilih.

1. Simpan cerita di **Proyek & Cerita**. Di **Storyboard & Karakter**, buka **Karakter dan gaya visual**, pilih shot, lalu sunting prompt. **Gunakan untuk Gambar** membawa deskripsi dan ID shot ke Studio Gambar. Klik **Simpan Draf Gambar** untuk menyimpannya. **Gunakan untuk Video** membawa prompt ke Buat Video.
2. Impor gambar di **Studio Gambar**, atau lampirkan media langsung di **Buat Video**. Di mode dengan referensi, **Pilih dari pustaka lokal** mencari media berdasarkan nama. Setelah dilampirkan, klik tag untuk memasukkannya ke prompt atau tombol × untuk melepasnya. Untuk tes lokal, URL boleh kosong. Untuk generate AIIDE, isi URL publik aset yang sama lalu tunggu status tersimpan.
3. Di **Buat Video**, **Perluas prompt** membuka ruang menulis. Cek jumlah karakter, batas media, dan durasi model. Buka **Alat tes lokal & draf** lalu pilih **Uji Mode Lokal**. Setelah lulus, pilih **Simpan Draf**.
4. Di **Persetujuan**, isi nama peninjau dan setujui sumber gambar, klip, atau audio yang akan dipakai. **Pakai di Studio Film** memilih sumber gambar atau klip. Klik **Tambah ke Susunan**, atur durasi, lalu **Simpan Susunan**. **Render Film Lokal** tersedia setelah semua sumber disetujui untuk versi cerita yang aktif. Render memakai FFmpeg dengan encoder libx264 dan AAC serta FFprobe di perangkat operator.
5. Di **Riwayat**, cari aktivitas atau draf berdasarkan nama model atau teks aktivitas. Daftar tugas video pada perangkat bisa disaring menurut status. Pilih **Buka Draf** untuk menyunting atau **Lihat hasil** untuk memutar hasil yang sudah tersedia.

Studio Gambar dan Studio Gerak menyimpan arahan produksi. Studio Suara dapat menyimpan narasi dan mengimpor audio. Pembuatan gambar AI dan TTS berbayar masih terkunci. Ekspor paket proyek di **Proyek & Cerita** untuk berbagi media dan draf dengan tim. Setiap perangkat memakai kredensial operatornya sendiri.
