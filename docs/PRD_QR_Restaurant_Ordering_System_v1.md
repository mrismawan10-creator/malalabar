# PRD: QR-Based Restaurant Ordering System

| Field | Detail |
|---|---|
| Versi | 1.0 Draft |
| Tanggal | 24 Juni 2026 |
| Status | Draft — Pending Dev Review |
| Platform | Web Application (Browser-based, No App Install) |
| Scope | Single Restaurant (Single Tenant) |
| Payment Gateway | Midtrans (Rekomendasi) |
| Prepared by | Awan |

---

## Daftar Isi

1. [Overview](#1-overview)
2. [User Roles & Access Matrix](#2-user-roles--access-matrix)
3. [Order Flow End-to-End](#3-order-flow-end-to-end)
4. [Feature Requirements](#4-feature-requirements)
   - 4.1 [QR Code & Table System](#41-qr-code--table-system)
   - 4.2 [Customer Interface](#42-customer-interface)
   - 4.3 [Kitchen Display System (KDS)](#43-kitchen-display-system-kds)
   - 4.4 [Cashier Interface](#44-cashier-interface)
   - 4.5 [Admin Dashboard](#45-admin-dashboard)
   - 4.6 [Analytics & Reports](#46-analytics--reports)
   - 4.7 [Superadmin Panel](#47-superadmin-panel)
5. [Payment System](#5-payment-system)
6. [Non-Functional Requirements](#6-non-functional-requirements)
7. [Tech Stack Recommendation](#7-tech-stack-recommendation)
8. [Out of Scope (V1)](#8-out-of-scope-v1)

---

## 1. Overview

### 1.1 Latar Belakang

Sistem ini mendigitalisasi proses pemesanan di restoran. Customer tidak perlu memanggil pelayan atau membaca menu fisik. Cukup scan QR di meja, browser terbuka langsung menampilkan menu digital, pesanan terkirim ke dapur via sistem, dan pembayaran selesai dari meja. Operasional lebih efisien, error berkurang, dan owner mendapat data penjualan yang actionable.

### 1.2 Tujuan Produk

- Menggantikan proses pemesanan manual dengan alur digital yang terstandarisasi
- Memberikan visibilitas real-time status pesanan kepada customer, dapur, dan kasir
- Mengintegrasikan multi-payment dalam satu sistem tanpa alat tambahan untuk online payment
- Memberikan analytics dan laporan penjualan yang bisa langsung digunakan untuk keputusan bisnis
- Memberikan kontrol penuh kepada owner/manager atas menu, promo, ketersediaan item, dan operasional harian

### 1.3 Batasan Scope V1

> Sistem ini dirancang untuk **satu restoran (single tenant)**. Semua interface berbasis web yang dapat diakses dari browser tanpa instalasi aplikasi. Tidak ada akun permanen untuk customer. Setiap sesi terikat pada meja dan berakhir setelah pembayaran selesai.

---

## 2. User Roles & Access Matrix

### 2.1 Deskripsi Role

| Role | Deskripsi | Interface Utama |
|---|---|---|
| **Superadmin** | Akses penuh ke seluruh sistem termasuk konfigurasi system-level, manajemen akun, dan override operasional | Admin Dashboard + System Settings |
| **Admin / Manager** | Kelola menu, kategori, promo, availability, tabel, dan akses laporan. Tidak bisa ubah konfigurasi system-level atau kelola akun | Admin Dashboard |
| **Kasir** | Approve atau reject pesanan masuk, proses pembayaran semua metode, lihat status seluruh meja aktif | Cashier Interface |
| **Staff Dapur** | Melihat pesanan yang sudah diapprove kasir, update status pesanan (proses dan siap) | Kitchen Display System (KDS) |
| **Customer** | Browse menu, kustomisasi item, tambah ke cart, submit pesanan, tracking status real-time, dan bayar | Customer Web App (via QR Scan) |

### 2.2 Access Matrix Detail

| Fitur / Aksi | Superadmin | Admin | Kasir | Dapur | Customer |
|---|:---:|:---:|:---:|:---:|:---:|
| Tambah / Edit / Hapus Menu | Ya | Ya | Tidak | Tidak | Tidak |
| Toggle Availability per Item | Ya | Ya | Tidak | Tidak | Tidak |
| Kelola Kategori Menu | Ya | Ya | Tidak | Tidak | Tidak |
| Kelola & Toggle Promo | Ya | Ya | Tidak | Tidak | Tidak |
| Definisikan Kustomisasi Item | Ya | Ya | Tidak | Tidak | Tidak |
| Generate & Download QR Meja | Ya | Ya | Tidak | Tidak | Tidak |
| Approve / Reject Pesanan | Ya | Tidak | Ya | Tidak | Tidak |
| Proses & Konfirmasi Pembayaran | Ya | Tidak | Ya | Tidak | Tidak |
| Update Status Pesanan di KDS | Ya | Tidak | Tidak | Ya | Tidak |
| Lihat Analytics & Reports | Ya | Ya | Tidak | Tidak | Tidak |
| Export Laporan (PDF / CSV) | Ya | Ya | Tidak | Tidak | Tidak |
| Kelola Akun Admin | Ya | Tidak | Tidak | Tidak | Tidak |
| Konfigurasi System Settings | Ya | Tidak | Tidak | Tidak | Tidak |
| Tambah / Ubah Alur Status Pesanan | Ya | Tidak | Tidak | Tidak | Tidak |
| Konfigurasi Metode Pembayaran | Ya | Tidak | Tidak | Tidak | Tidak |
| Lihat Audit Log Sistem | Ya | Tidak | Tidak | Tidak | Tidak |
| Browse Menu & Submit Pesanan | Tidak | Tidak | Tidak | Tidak | Ya |
| Tracking Status Pesanan Real-time | Tidak | Tidak | Tidak | Tidak | Ya |
| Inisiasi & Pilih Metode Pembayaran | Tidak | Tidak | Tidak | Tidak | Ya |

---

## 3. Order Flow End-to-End

### 3.1 Alur Utama Pesanan

| Step | Aktor | Aksi | Hasil / Output |
|---|---|---|---|
| 1 | Customer | Scan QR Code di meja | Browser membuka Customer Web App. URL mengandung `table_id` unik (contoh: `/order?t=[secure_token]`) |
| 2 | Customer | Browse menu, lihat promo, pilih item, atur kustomisasi dan catatan | Cart terisi dengan detail item, kustomisasi yang dipilih, dan harga per item |
| 3 | Customer | Review cart dan submit pesanan | Pesanan masuk ke sistem dengan status **Menunggu Konfirmasi**. Kasir mendapat notifikasi |
| 4 | Kasir | Review pesanan masuk di Cashier Interface, klik Approve | Status berubah jadi **Pesanan Diterima**. Pesanan tampil di KDS. Customer mendapat update status |
| 5 | Dapur | Melihat pesanan baru di KDS, mulai memproses | Staff klik Mulai Proses. Status berubah jadi **Pesanan Diproses**. Customer dan kasir mendapat update |
| 6 | Dapur | Makanan selesai disiapkan | Staff klik Pesanan Siap di KDS. Status berubah jadi **Pesanan Siap**. Customer dan kasir mendapat notifikasi |
| 7 | Customer | (Opsional) Ingin tambah pesanan | Customer buat order batch baru dari cart. Flow kembali ke Step 3 sebagai order record terpisah |
| 8 | Customer | Selesai memesan, inisiasi pembayaran | Layar bill muncul dengan semua order batch, rincian item, dan total tagihan |
| 9a | Customer | Pilih Cash | Instruksi bayar ke kasir muncul. Kasir proses secara manual dan konfirmasi di sistem |
| 9b | Customer / Kasir | Pilih Kartu | Kasir proses di POS terminal fisik. Setelah selesai, kasir konfirmasi manual di sistem |
| 9c | Customer | Pilih Online (Midtrans) | Redirect ke halaman Midtrans. Customer pilih metode (QRIS, VA, e-wallet). Webhook otomatis konfirmasi ke sistem |
| 10 | Sistem | Pembayaran terkonfirmasi | Sesi meja ditutup. Data transaksi tersimpan. Customer mendapat struk digital. Tabel kembali kosong |

### 3.2 Status Pesanan

| Status | Trigger | Siapa yang Trigger | Terlihat Oleh |
|---|---|---|---|
| `Menunggu Konfirmasi` | Customer submit order dari cart | Otomatis oleh sistem | Customer, Kasir |
| `Pesanan Diterima` | Kasir klik Approve di Cashier Interface | Kasir | Customer, Kasir, KDS |
| `Pesanan Diproses` | Staff dapur klik Mulai Proses di KDS | Staff Dapur | Customer, KDS, Kasir |
| `Pesanan Siap` | Staff dapur klik Pesanan Siap di KDS | Staff Dapur | Customer, KDS, Kasir |

> Setelah pembayaran selesai, sesi meja tertutup. Jika customer ingin memesan lagi dari meja yang sama, harus scan QR ulang. Order berikutnya akan menjadi sesi dan record transaksi yang sepenuhnya terpisah.

---

## 4. Feature Requirements

---

### 4.1 QR Code & Table System

#### 4.1.1 Manajemen Meja

- Admin dapat menambah meja baru dengan nomor meja dan area/lantai (contoh: Meja 05, Area Outdoor)
- Admin dapat mengedit nomor, nama area, atau menonaktifkan meja sementara
- Meja yang dinonaktifkan: QR tidak dapat diakses oleh customer

#### 4.1.2 QR Code Generation

- Setiap meja memiliki QR Code unik yang mengandung `table_id` terenkripsi dalam URL
- Format URL: `https://[domain]/order?t=[secure_token]` — token aman, bukan nomor meja langsung
- Admin dapat generate dan download QR Code per meja dalam format **PNG** (digital) dan **PDF** (siap cetak A5 atau kartu)
- Admin dapat **regenerate** QR Code kapan saja. QR lama otomatis invalid saat QR baru digenerate

#### 4.1.3 Sesi Customer

- Sesi customer terikat pada browser tab dan table token
- Sesi berakhir otomatis setelah pembayaran selesai atau setelah periode inactivity (default: 90 menit, configurable oleh Superadmin)
- Cart tidak dibagikan antar device yang mengakses QR meja yang sama

---

### 4.2 Customer Interface

#### 4.2.1 Promo Section (Tampil di Halaman Utama)

- Ditempatkan di **paling atas halaman** sebagai banner horizontal (carousel atau horizontal scroll)
- Setiap promo card menampilkan: foto item, nama menu, harga asli (dicoret), harga promo, badge diskon (contoh: `-20%`)
- Mendukung beberapa promo sekaligus. Jika lebih dari 3, tampil sebagai scrollable row
- Klik promo card: langsung membuka halaman detail item tersebut
- Promo yang statusnya nonaktif **tidak tampil sama sekali** di customer interface

#### 4.2.2 Menu Display & Navigasi Kategori

- Di bawah promo section terdapat tab/pill navigasi kategori yang dapat di-scroll horizontal
- Tab default yang selalu ada: **Semua**. Tab lainnya sesuai kategori yang dibuat admin
- Contoh kategori: Appetizers, Main Course, Desserts, Drinks, dll (dapat dikustomisasi)
- Setiap item menu menampilkan: foto, nama, deskripsi singkat, harga, status availability
- Item dengan status **Habis**: tampil dengan overlay abu-abu, label `HABIS`, tidak bisa ditambah ke cart
- Status availability terupdate **real-time** tanpa perlu reload halaman (menggunakan WebSocket)

#### 4.2.3 Kustomisasi Item Menu

- Saat customer klik item menu, muncul modal atau drawer yang menampilkan opsi kustomisasi
- Tipe kustomisasi yang didukung sistem:
  - **Single-select** (wajib atau opsional): contoh Level Kepedasan — pilih satu dari: Tidak Pedas, Sedikit Pedas, Sedang, Pedas, Extra Pedas
  - **Multi-select dengan harga tambahan**: contoh Add-On — Tambah Sayur +Rp 2.000, Tambah Saus Sambal +Rp 1.500, Tambah Kerupuk +Rp 1.000
  - **Pilihan porsi/ukuran** jika relevan: contoh Regular, Large +Rp 5.000
- Kolom **catatan bebas** per item: customer bisa tulis permintaan spesial (contoh: "kurangi garam", "alergi kacang")
- Sub-total per item terupdate otomatis saat customer memilih add-on

#### 4.2.4 Cart & Multi-Order dalam Satu Sesi

- Cart persisten selama sesi meja aktif
- Customer dapat mengubah quantity atau menghapus item dari cart sebelum submit
- Summary cart menampilkan: semua item dengan kustomisasi yang dipilih, harga satuan, subtotal per item, dan total keseluruhan
- Customer dapat submit order **berkali-kali** sebelum bayar. Setiap submit menghasilkan **order batch baru**
- Semua order batch dalam satu sesi tampil di halaman status dengan tracking masing-masing
- Setelah pembayaran, sesi ditutup. Pemesanan tambahan memerlukan scan QR ulang dan akan menjadi transaksi terpisah

#### 4.2.5 Order Status Tracking

- Halaman status menampilkan semua order batch yang aktif dalam sesi
- Setiap order batch memiliki stepper visual: Menunggu Konfirmasi → Pesanan Diterima → Pesanan Diproses → Pesanan Siap
- Status terupdate **real-time** via WebSocket tanpa perlu refresh halaman
- Notifikasi visual (pulse atau badge) saat ada perubahan status baru
- Browser notification (jika customer mengizinkan) saat pesanan siap

#### 4.2.6 Pembayaran

- Customer membuka halaman bill: ringkasan semua order batch, rincian item + kustomisasi, harga, pajak/service charge (jika ada), dan total
- Pilihan metode pembayaran (sesuai yang diaktifkan Superadmin):
  - **Cash**: tampilkan instruksi "Silakan bayar ke kasir, total: Rp XX.XXX". Kasir konfirmasi setelah menerima uang
  - **Kartu Debit/Kredit**: tampilkan instruksi untuk menghubungi kasir. Kasir proses di POS terminal eksternal lalu konfirmasi di sistem
  - **Online (Midtrans)**: customer diarahkan ke halaman Midtrans Snap. Pilih sendiri dari QRIS, VA bank, GoPay, OVO, Dana, ShopeePay, dll. Konfirmasi otomatis via webhook
- Setelah pembayaran terkonfirmasi: digital receipt tampil berisi nomor transaksi, rincian pesanan, total, dan metode bayar

---

### 4.3 Kitchen Display System (KDS)

Interface eksklusif untuk staff dapur. Diakses lewat browser di tablet atau monitor yang dipasang di dapur. Akses menggunakan device login khusus dapur, tanpa perlu akun personal per staff.

#### 4.3.1 Tampilan Utama KDS

- Layout **full-screen** dengan kartu pesanan yang ditampilkan dalam grid (2–3 kolom sesuai ukuran layar)
- Kartu pesanan yang tampil adalah pesanan yang sudah diapprove kasir, diurutkan **FIFO** (masuk lebih awal tampil lebih dulu)
- Setiap kartu menampilkan: nomor meja, nomor batch order, daftar item dengan kustomisasi lengkap (level pedas, add-on, catatan customer), dan **elapsed time** sejak pesanan diterima
- Indikator urgensi visual: kartu berubah warna **kuning** jika sudah menunggu lebih dari 10 menit, **merah** jika lebih dari 20 menit
- Notifikasi audio (ding) saat pesanan baru masuk ke KDS

#### 4.3.2 Update Status oleh Staff Dapur

- Tombol **Mulai Proses** pada kartu: status berubah ke `Pesanan Diproses`. Update real-time ke customer interface dan cashier
- Tombol **Pesanan Siap** pada kartu: status berubah ke `Pesanan Siap`. Kartu bergeser ke kolom Selesai. Kasir mendapat notifikasi
- Staff dapur **tidak dapat** mengubah konten pesanan, hanya update status

#### 4.3.3 Sync ke Kasir

- Saat staff menandai Pesanan Siap, Cashier Interface menampilkan notifikasi bahwa item dari meja tertentu sudah siap
- Kasir dapat melihat ringkasan semua pesanan yang sudah siap dari meja aktif tertentu

---

### 4.4 Cashier Interface

#### 4.4.1 Dashboard Kasir

- Panel utama: daftar pesanan masuk yang **menunggu approval**, diurutkan berdasarkan waktu masuk
- Setiap item dalam antrian: nomor meja, jumlah item, total estimasi harga, dan timestamp
- Badge / counter pada tab Pending saat ada pesanan baru masuk
- Panel kedua: daftar **meja aktif** dengan status keseluruhan pesanan dan total tagihan yang belum dibayar

#### 4.4.2 Approval Pesanan

- Kasir membuka detail pesanan: meja, semua item, kustomisasi, quantity, dan total harga
- Klik **Approve**: pesanan diteruskan ke KDS, status customer berubah ke `Pesanan Diterima`
- Klik **Reject**: kasir wajib mengisi alasan penolakan. Customer mendapat notifikasi pesanan ditolak beserta alasannya

#### 4.4.3 Proses Pembayaran

- Kasir memilih meja aktif dan melihat total tagihan dari semua order batch yang sudah selesai
- **Cash**: kasir input nominal uang yang diterima. Sistem otomatis hitung kembalian. Klik Konfirmasi Pembayaran
- **Kartu**: kasir proses di POS terminal fisik terlebih dahulu. Setelah selesai, klik Konfirmasi Pembayaran Kartu di sistem
- **Online**: jika webhook Midtrans sudah masuk, status otomatis terkonfirmasi. Kasir dapat melihat konfirmasi di dashboard
- Setelah pembayaran dikonfirmasi, sesi meja ditutup dan tabel kembali kosong di dashboard kasir

---

### 4.5 Admin Dashboard

#### 4.5.1 Menu Management

- List semua menu dengan thumbnail, nama, kategori, harga, dan status availability
- Filter dan pencarian menu berdasarkan kategori, nama, atau status
- **Tambah menu baru**: upload foto (maks 2MB, format JPG/PNG), nama, deskripsi, kategori, harga dasar, dan opsi kustomisasi
- **Edit menu**: semua field dapat diubah termasuk definisi kustomisasi dan add-on
- **Hapus menu**: dialog konfirmasi sebelum penghapusan permanen
- **Toggle availability per item**: satu klik tanpa perlu buka form edit. Status langsung tersync ke customer interface
- **Bulk availability**: centang beberapa item sekaligus, ubah status semua bersama-sama

#### 4.5.2 Category Management

- List semua kategori beserta jumlah item yang terhubung
- Tambah kategori baru: nama dan ikon opsional
- Edit nama dan ikon kategori yang sudah ada
- Hapus kategori: sistem meminta konfirmasi dan opsi untuk memindahkan menu yang terhubung ke kategori lain sebelum penghapusan
- **Atur urutan tampilan** kategori di customer interface (drag-and-drop atau input nomor urut)

#### 4.5.3 Promo Management

- List semua promo: item menu yang dipromosikan, harga asli, harga promo, status aktif/nonaktif
- **Buat promo baru**: pilih menu item dari dropdown, set harga promo atau persentase diskon, tambah label promo opsional (contoh: "Promo Siang")
- Edit harga promo atau label kapan saja
- **Toggle aktif/nonaktif**: satu klik langsung tersync ke homepage customer. Desain toggle harus jelas dan mudah ditemukan, bukan tersembunyi di dalam form
- Satu item menu hanya boleh memiliki satu promo aktif dalam satu waktu. Sistem menolak jika admin coba aktifkan dua promo untuk item yang sama

#### 4.5.4 Kustomisasi Item Menu

Admin mendefinisikan grup kustomisasi per item menu dengan properti berikut:

| Properti | Keterangan |
|---|---|
| Nama grup | Contoh: "Level Kepedasan", "Pilihan Add-On", "Ukuran Porsi" |
| Tipe input | `single-select` (pilih tepat satu) atau `multi-select` (pilih satu atau lebih) |
| Required | Wajib diisi atau opsional. Jika wajib, customer tidak bisa submit tanpa memilih |
| Daftar pilihan | Nama pilihan dan harga tambahan (Rp 0 jika gratis) |

Satu item menu dapat memiliki **beberapa grup kustomisasi** sekaligus.

#### 4.5.5 Table & QR Management

- List semua meja: nomor, area, status (aktif/nonaktif), status QR (valid/expired)
- Tambah meja baru dengan nomor dan area/lantai
- Generate QR Code per meja: tombol Generate QR dan Download (PNG dan PDF)
- **Regenerate QR**: QR lama otomatis invalid. Tombol disertai konfirmasi dialog
- Nonaktifkan meja: customer tidak bisa akses via QR, tetapi data meja tetap tersimpan

---

### 4.6 Analytics & Reports

#### 4.6.1 Sales Analytics Dashboard

Diakses oleh Superadmin dan Admin. Semua metrik dapat difilter berdasarkan periode waktu.

Filter periode yang tersedia: **Hari Ini, 7 Hari Terakhir, Bulan Ini, Bulan Lalu, Custom Range** (pilih tanggal mulai dan selesai).

| Metric | Deskripsi | Visualisasi |
|---|---|---|
| Total Revenue | Total pendapatan dari semua transaksi yang sudah lunas dalam periode | Angka besar + perbandingan periode sebelumnya |
| Total Orders | Jumlah order batch yang selesai (tidak termasuk yang dibatalkan) | Angka + trend arrow |
| Average Order Value | Total revenue dibagi total orders | Angka + perbandingan |
| Top 10 Best-Selling Items | Ranking item berdasarkan quantity terjual dalam periode | Bar chart horizontal |
| Revenue by Category | Breakdown pendapatan per kategori menu | Pie chart + tabel |
| Revenue by Hour | Distribusi pendapatan per jam — identifikasi peak hours | Bar chart per jam |
| Order Volume by Day | Jumlah pesanan per hari dalam periode yang dipilih | Line chart atau bar chart |
| Payment Method Breakdown | Persentase dan total nominal per metode: cash, kartu, online | Donut chart + tabel |

#### 4.6.2 Order History

- Tabel riwayat lengkap semua pesanan dengan kolom: ID Order, Tanggal & Waktu, Nomor Meja, Total Item, Total Harga, Metode Bayar, Status
- Filter: berdasarkan rentang tanggal, metode pembayaran, status, atau nomor meja
- Pencarian: berdasarkan ID order
- Klik per baris: buka detail order — semua item, kustomisasi per item, harga, timestamp setiap perubahan status

#### 4.6.3 Export Reports

| Jenis Report | Format | Konten yang Diekspor |
|---|---|---|
| Sales Summary | PDF, CSV | Total revenue, total orders, AOV, top items, breakdown per kategori dan per payment method dalam periode yang dipilih |
| Order History | CSV | Semua order dalam periode: ID, tanggal, waktu, nomor meja, item (nama + kustomisasi + harga), total, metode bayar, status, timestamp setiap update status |
| Menu Performance | PDF, CSV | Ranking semua menu berdasarkan quantity terjual, total revenue per item, jumlah hari item berstatus Habis |
| Payment Report | PDF, CSV | Breakdown per metode pembayaran: jumlah transaksi dan total nominal per metode dalam periode yang dipilih |

> **Export PDF**: dokumen terformat dengan header restoran, logo, ringkasan eksekutif, dan grafik visualisasi.
> **Export CSV**: raw data yang dapat langsung dibuka di Microsoft Excel atau Google Sheets tanpa software tambahan.

---

### 4.7 Superadmin Panel

Superadmin memiliki semua kemampuan Admin ditambah akses ke fitur-fitur berikut:

#### 4.7.1 Manajemen Akun

- Buat akun Admin baru: nama, email, password sementara (wajib diganti saat login pertama)
- Edit informasi akun Admin yang ada
- **Suspend** (nonaktifkan) akun Admin: akun tidak bisa login tetapi data tidak dihapus
- Aktifkan kembali akun Admin yang di-suspend
- Lihat log aktivitas per akun: siapa yang membuat atau mengubah data apa, dengan timestamp

#### 4.7.2 System Settings

- Informasi restoran: nama, logo, deskripsi singkat, jam operasional (tampil di customer interface)
- Konfigurasi pajak dan service charge: persentase PPN dan/atau service charge, dengan opsi on/off
- Tema warna: warna primer tombol dan elemen utama di customer interface
- Timeout sesi: durasi inactivity sebelum sesi customer otomatis berakhir
- Metode pembayaran: aktifkan atau nonaktifkan Cash, Kartu, dan/atau Online Payment secara individual

#### 4.7.3 Konfigurasi Alur Status Pesanan

- Tambah tahap status baru ke dalam alur pesanan
- Edit nama atau deskripsi tahap status yang ada
- Ubah urutan tahap status
- Nonaktifkan tahap status tertentu (tidak dihapus permanen untuk menjaga integritas data historis)
- Perubahan hanya berlaku untuk pesanan baru yang dibuat setelah perubahan disimpan

#### 4.7.4 Override & Kontrol Darurat

- Cancel pesanan yang sedang berjalan dari interface mana pun, dengan alasan yang wajib diisi dan tercatat di audit log
- Paksa tutup sesi meja tertentu jika diperlukan
- Lihat **full audit log sistem**: seluruh aksi yang dilakukan semua role dicatat dengan timestamp dan IP address

---

## 5. Payment System

### 5.1 Rekomendasi: Midtrans sebagai Primary Payment Gateway

| Aspek | Detail |
|---|---|
| Coverage Metode Bayar | QRIS (semua e-wallet dalam satu QR), Virtual Account semua bank besar (BCA, BNI, BRI, Mandiri, Permata), GoPay, OVO, Dana, ShopeePay, Kartu Kredit/Debit Visa/Mastercard |
| Jenis Integrasi | **Snap API** (direkomendasikan untuk V1): popup payment page siap pakai, tanpa perlu build UI custom. Core API untuk kontrol penuh di V2 |
| Konfirmasi Pembayaran | Webhook HTTP POST otomatis ke backend saat transaksi berhasil. Tidak perlu polling manual |
| Settlement | T+1 untuk sebagian besar metode. Langsung ke rekening bank restoran |
| Dashboard Merchant | Portal `midtrans.com` untuk memonitor semua transaksi, refund, dan laporan secara independen |
| Keamanan | PCI-DSS Level 1 compliant. Fraud detection built-in. Data kartu tidak melewati server restoran |
| Biaya Transaksi | MDR bervariasi per metode: QRIS ~0.7%, Virtual Account flat fee per transaksi, Kartu 1.5–2.9%. Tidak ada biaya setup untuk akun sandbox |
| Dokumentasi | `docs.midtrans.com`: paling lengkap di Indonesia, tersedia dalam Bahasa Indonesia dan English |

### 5.2 Arsitektur Pembayaran per Metode

| Metode | Alur | Konfirmasi Kasir |
|---|---|---|
| Cash | Customer pilih Cash → layar tampilkan instruksi dan total tagihan → customer bayar langsung ke kasir | Manual: kasir input nominal, klik Konfirmasi di sistem |
| Kartu | Customer pilih Kartu → layar tampilkan instruksi ke kasir → kasir proses di POS terminal fisik eksternal | Manual: kasir klik Konfirmasi Pembayaran Kartu setelah POS terminal approved |
| Online (Midtrans) | Customer pilih Online → redirect ke halaman Midtrans Snap → customer pilih metode dan bayar → webhook Midtrans kirim konfirmasi ke backend otomatis | Otomatis: tidak perlu konfirmasi manual kasir. Status tabel terupdate via webhook |

> **Alternatif**: Xendit dapat menggantikan Midtrans jika dibutuhkan H+0 settlement untuk beberapa metode. Secara arsitektur, penggantian gateway hanya membutuhkan perubahan di payment service layer dan tidak mempengaruhi flow antarmuka.

---

## 6. Non-Functional Requirements

| Kategori | Requirement |
|---|---|
| Performance | Customer web app first contentful paint < 3 detik di koneksi 4G. Admin dashboard load < 5 detik |
| Real-time Sync | Perubahan status pesanan dan availability menu terrefleksi di semua interface dalam < 2 detik via WebSocket |
| Kapasitas | Sistem mampu mendukung minimum 50 concurrent active user (gabungan customer + staff) tanpa degradasi performa signifikan |
| Mobile-First Design | Customer interface dioptimalkan untuk viewport 360–428px (Android dan iPhone). Font minimal 16px. Touch target minimal 44×44px |
| Security | Semua komunikasi via HTTPS/TLS. Role-based access control diterapkan di server-side (bukan hanya di frontend). Token sesi menggunakan signed JWT dengan expiry |
| Browser Support | Customer: Chrome Android, Safari iOS, Samsung Internet (2 versi terakhir). Admin: Chrome dan Firefox (2 versi terakhir) |
| Availability | Target uptime 99.5% per bulan. Maintenance dijadwalkan di luar jam operasional restoran |
| Data Retention | Riwayat pesanan dan transaksi disimpan minimum 2 tahun untuk keperluan laporan dan audit |
| Graceful Degradation | Jika koneksi WebSocket terputus, sistem tampilkan pesan error yang jelas dengan tombol retry. Cart tidak hilang selama tab browser tidak ditutup |
| Audit Trail | Setiap aksi yang dilakukan admin dan kasir dicatat: aksi apa, siapa, kapan, dan dari IP mana. Log disimpan minimum 1 tahun |

---

## 7. Tech Stack Recommendation

> Rekomendasi ini tidak bersifat mengikat. Tim developer dapat menyesuaikan berdasarkan keahlian yang dimiliki. Prioritas utama: arsitektur mendukung real-time update via WebSocket dan customer experience yang mobile-first.

| Layer | Teknologi | Alasan |
|---|---|---|
| Customer Web App | Next.js (PWA-ready) | SSR untuk load cepat, dapat diinstall sebagai PWA, satu codebase untuk mobile dan desktop |
| Admin & Superadmin UI | Next.js atau React + Vite | Ekosistem luas, mudah integrasi library dashboard (Recharts, Tremor), component-based |
| Kitchen Display System | React | Lightweight, full-screen display, real-time update via Socket.io |
| Backend / API | Node.js + Fastify atau Express | JavaScript full-stack (konsisten dengan frontend), performa baik untuk WebSocket dan concurrent request |
| Database | PostgreSQL | Relational dan handal untuk data transaksi, mendukung analytics query yang kompleks |
| Real-time | Socket.io | WebSocket abstraction, fallback ke long-polling otomatis jika WS tidak tersedia |
| Session & Cache | Redis | Fast session management, caching data menu yang sering diakses, temporary state untuk order queue |
| Payment Integration | Midtrans Snap API | Integrasi paling cepat, UI payment page sudah disediakan Midtrans, webhook handler tersedia di semua bahasa |
| File & Image Storage | Cloudinary atau Supabase Storage | Upload foto menu, CDN global untuk optimasi gambar otomatis (resize dan format WebP) |
| Deployment | Railway, Render, atau VPS | Low-maintenance untuk tim kecil. Railway dan Render mendukung PostgreSQL dan Redis managed service sekaligus |

---

## 8. Out of Scope (V1)

Fitur-fitur berikut tidak termasuk dalam scope V1. Keputusan ini untuk menjaga fokus agar produk inti dapat selesai dan diluncurkan dengan kualitas yang baik.

| Fitur | Catatan untuk V2+ |
|---|---|
| Loyalty Program / Poin Reward | Membutuhkan sistem akun customer permanen dan persistent user profile |
| Reservasi Meja Online | Memerlukan integrasi manajemen jadwal, reminder notifikasi, dan deposit payment yang berbeda scope |
| Multi-Branch / Multi-Restoran | Butuh arsitektur multi-tenant yang berbeda secara fundamental dari single-tenant V1 |
| Manajemen Inventori & Stok Bahan | Auto-deduct stok saat pesanan masuk, alerting low stock, supplier management |
| Manajemen Absensi & Shift Staff | Di luar scope aplikasi pemesanan. Lebih cocok sebagai modul HRIS terpisah |
| Native Push Notification ke HP | V1 menggunakan browser notification. Firebase Cloud Messaging (FCM) untuk native push di V2 |
| Akun Customer Permanen & History | Customer di V1 bersifat anonymous per sesi. Akun dengan riwayat pesanan untuk V2 |
| Review & Rating Menu | Memerlukan akun customer permanen. Implementasi bersamaan dengan fitur akun di V2 |
| Promo Time-based Otomatis | Happy hour atau promo yang aktif otomatis di jam tertentu. V1 hanya mendukung toggle manual |
| Integrasi Thermal Printer Struk | ESC/POS atau Bluetooth printer untuk cetak struk fisik. V1 hanya digital receipt di layar |
| Refund Management | Cancel dan refund pesanan yang sudah dibayar online memerlukan integrasi Midtrans Refund API |
| Customer Feedback per Kunjungan | Survey singkat atau rating pasca-makan untuk meningkatkan layanan |

---

*Dokumen ini adalah living document. Setiap perubahan scope, keputusan arsitektur, atau penambahan fitur yang material wajib diperbarui di sini sebelum sprint development dimulai.*
