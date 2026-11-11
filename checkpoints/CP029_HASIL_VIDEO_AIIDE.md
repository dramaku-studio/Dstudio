# CP029 · Hasil video AIIDE

Saat studio lokal berjalan, backend memeriksa status task AIIDE yang sudah dikirim. Tab browser boleh ditutup. Jika studio dihentikan, pemeriksaan dilanjutkan saat studio dinyalakan kembali.

1. Buka **Buat Video → Hasil Video** untuk melihat status task. Untuk task dari dashboard AIIDE, masukkan Task ID melalui bagian pengambilan hasil dan pilih akun yang membuatnya.
2. Setelah AIIDE mengirim hasil, studio mengambil MP4 dari host hasil yang diizinkan, memvalidasi media dengan FFprobe, lalu menampilkan pemutar dan **Unduh MP4**.
3. Buka **Aset** untuk melihat salinan otomatis pada proyek asal. Jika belum ada proyek ketika task dibuat, hasil masuk ke pustaka umum lokal. Masa simpan salinan pustaka adalah 72 jam sejak disimpan. Gunakan **Unduh MP4** untuk menyimpan berkas di luar pustaka.
4. Jika penyimpanan pustaka penuh, MP4 yang sudah diterima masih dapat diunduh dari Hasil Video. Setelah mengosongkan ruang, gunakan **Simpan ke Aset proyek aktif**. Jika unduhan dari AIIDE tertunda, gunakan **Refresh** untuk memeriksa task yang sama.
5. Jika AIIDE melaporkan kegagalan, lihat status pada riwayat tugas. Pemeriksaan status dan pengambilan hasil hanya menggunakan task yang sudah ada.

Alur sukses diuji di Chrome menggunakan provider mock dan berkas MP4 lokal, termasuk penyelesaian task saat tab tertutup dan unduhan lewat kedua menu.
