# Dramasaku Studio CP021 / v0.7.0

## Instalasi per komputer
1. Instal Node.js 24 LTS (22 juga diuji), Git, FFmpeg dan FFprobe. Pastikan `node --version`, `npm --version`, `ffmpeg -version`, `ffprobe -version` berjalan di terminal baru.
2. Clone `https://github.com/warkai-id/dramasakustudio.git` lalu `cd dramasakustudio`. Repo privat: akun anggota tim harus diberi akses. Alternatif: unduh ZIP v0.7.0 dari Releases dan ekstrak.
3. Jalankan `npm run dev`. Mode console lokal tidak memerlukan npm install, Docker atau PostgreSQL.
4. Buka http://127.0.0.1:4184 dan masukkan kode operator yang tercetak di terminal komputer itu. Terminal tetap berjalan; Ctrl+C untuk berhenti.

## Lokal → input API → engine siap
1. Buka Kunci API, pilih kelompok **Video**, penyedia **AIIDE**. Masukkan key milik operator, beri label, klik Tambahkan Kunci.
2. Backend lokal menyimpan key terenkripsi dan memeriksa `GET https://www.aiide.com/v1/models`. Key tidak dikirim ke GitHub. Pemeriksaan ini tidak membuat video.
3. Buka Buat Video. Engine siap jika key aktif, kuota lokal tersedia dan katalog mengandung model yang didukung. Model yang tidak ada pada katalog tidak dapat dikirim. Key ditolak, timeout, pembatasan provider atau katalog tidak cocok membuat engine belum siap.
4. Pilih model/mode, isi prompt/referensi, jalankan **Uji Mode Lokal** dahulu. Ini simulasi transport, bukan hasil AI asli.
5. Untuk pemakaian berbayar oleh operator: klik tombol generate AIIDE dan setujui biaya. Backend memeriksa ulang key/model sebelum satu POST video. Input key saja tidak menjalankan generate. Saldo, izin generate akun dan hasil video tidak dibuktikan oleh GET katalog.
6. Batas lokal: satu job baru per hari UTC, tanpa retry otomatis. `submission_unknown` harus diperiksa di Task Logs AIIDE; jangan kirim ulang. Key prioritas terpilih yang tidak valid tidak otomatis diganti ke akun berbayar lain.

## Uji tanpa generate berbayar
Tidak perlu memasukkan key untuk Uji Mode Lokal. Untuk mengunci tombol generate meskipun key tersimpan:

macOS/Linux:
```sh
STUDIO_OFFLINE=1 npm run dev
```
Windows PowerShell:
```powershell
$env:STUDIO_OFFLINE="1"
npm run dev
```
Untuk mengembalikan aktivasi otomatis, hentikan aplikasi; macOS/Linux jalankan `npm run dev` tanpa variabel tersebut; PowerShell jalankan `Remove-Item Env:STUDIO_OFFLINE` lalu `npm run dev`. Mode ini mengunci generate, bukan seluruh akses jaringan: Periksa Koneksi dan cek task lama masih GET read-only.

## Referensi dan hasil
Referensi lokal harus mempunyai URL HTTPS yang bisa diakses provider sebelum generate live; aplikasi tidak otomatis mengunggah berkas pribadi. Unduhan hasil otomatis hanya menerima host CDN HTTPS yang disetujui melalui `DRAMASAKU_AIIDE_MEDIA_HOSTS` (nama host persis, dipisahkan koma). Jika belum disetujui, buka hasil pada dashboard AIIDE dan impor media secara manual. Jangan menambahkan host asing untuk melewati error.

## Berbagi dan upgrade
Satu operator per komputer. Ekspor/impor paket proyek `.studio.json` melalui menu Proyek untuk bertukar pekerjaan; media maksimal 64 MB. Jangan berbagi `.local-private`, API key atau kode operator. Proyek yang diimpor tidak mengaktifkan key atau biaya di komputer penerima.

Sebelum upgrade, hentikan aplikasi dan cadangkan folder kerja secara privat. Untuk clone bersih gunakan `git pull --ff-only`; untuk ZIP ekstrak ke folder baru. Pindahkan `.local-private` hanya secara lokal jika memerlukan data lama, setelah backup; jangan menimpanya dengan data komputer lain. CP021 akan memeriksa ulang key tersimpan ketika status video dibuka. Gunakan STUDIO_OFFLINE=1 saat pertama membuka data lama bila ingin tetap terkunci.

Generate gambar/TTS tetap OFF. UI Aragi tetap hitam dengan aksen putih/biru langit. Pengujian rilis memakai mock tanpa request generate berbayar; kompatibilitas akun, saldo dan hasil provider nyata belum diuji.
