# Job Tracker Berbasis CV

Aplikasi web sederhana: upload CV (PDF) → sistem membaca isi CV → mencari lowongan kerja
di **Glints** → filter berdasarkan tanggal posting → beri skor kecocokan (skill, pengalaman,
posisi, lokasi, gaji vs UMR) → tampilkan **Top 10 lowongan paling relevan**.

Tidak ada login, tidak ada database. Semua data hanya disimpan sementara di memory selama
aplikasi berjalan — begitu server backend di-restart, hasil pencarian hilang.

---

## 0. Changelog perbaikan terbaru

Daftar ini merangkum perbaikan atas masalah-masalah yang sebelumnya ditemukan:

1. **Parser CV dipisah berdasarkan section.** Posisi pengalaman sekarang dicari hanya dari bagian
   `Experience/Work Experience/Pengalaman Kerja`; target pekerjaan tidak lagi ikut terbaca sebagai
   pengalaman. Pendidikan juga dibaca sampai section berikutnya, bukan sekadar mengambil empat baris.
2. **Target job dipisahkan dari keyword pencarian.** `targetJobs` dipakai untuk komponen `positionScore`,
   sedangkan `keywords` dipakai untuk scraping. Ini mencegah skill atau target bebas menggelembungkan
   skor pengalaman posisi. Parser juga mencoba membaca `domisili/location` dari CV untuk komponen lokasi.
3. **Salary parser diperbaiki untuk format Indonesia.** Contoh `4.5 jt`, `4 - 6 juta`, `4,5 juta - 6 juta`,
   dan `Rp4.000.000 - Rp5.500.000` sekarang diparse menjadi angka minimum/maksimum yang benar.
4. **Lookup UMR tidak lagi memilih substring pertama.** Exact match diprioritaskan, lalu partial match
   hanya dipakai kalau kemiripannya cukup tinggi; lokasi seperti `Bandung Barat` tidak otomatis
   dipetakan ke UMK `Bandung`. Kalau UMK spesifik tidak tersedia, sistem boleh fallback ke UMP provinsi.
5. **Pagination scraper menunggu halaman benar-benar berubah.** Sebelumnya keberadaan job card lama
   bisa membuat scraper menganggap halaman berikutnya sudah siap. Sekarang scraper membandingkan URL
   dan marker job pertama sebelum lanjut. `Promise.any` juga dipakai untuk menunggu salah satu selector
   job card, jadi timeout satu selector tidak menghentikan selector fallback lain.
6. **Scraper membedakan selector rusak vs hasil kosong.** Jika job card tidak ditemukan dan halaman tidak
   menunjukkan pesan empty-state, scraper melempar error eksplisit supaya tidak dilaporkan sebagai
   "tidak ada lowongan" secara keliru.
7. **Endpoint publik diberi proteksi resource.** Upload CV dan search job punya rate limit sederhana,
   jumlah search Playwright concurrent dibatasi, payload search dibatasi ukurannya, dan search dibatalkan
   saat client disconnect agar browser tidak terus berjalan tanpa pemakai.
8. **Upload PDF diverifikasi dua tahap.** MIME type tetap dicek oleh Multer, lalu backend juga memeriksa
   magic header `%PDF-` sebelum `pdf-parse`. Dependency `multer` di-upgrade ke lini 2.x.
9. **Frontend mencegah duplicate request.** Tombol Analyze/Search dinonaktifkan selama request berjalan,
   dan parser NDJSON tetap memproses buffer terakhir meski response tidak memiliki trailing newline.
10. **Batas scraping dibuat konservatif.** Default deployment Vercel sekarang `MAX_PAGES_PER_KEYWORD=1`,
    `DESCRIPTION_ENRICH_LIMIT=3`, dan `SCRAPE_DELAY_MS=500`; hard cap tetap diterapkan untuk mencegah satu request
    berkembang menjadi terlalu banyak navigasi browser.
11. **Matching tetap mempertahankan perbaikan sebelumnya:** deskripsi job ikut dinilai, gaji di bawah
    UMR tidak dibuang otomatis, location scoring granular, dan progress dikirim secara streaming.

12. **Parser CV diperbaiki untuk CV berbahasa Indonesia.** Heading seperti `Kemampuan`, `Sertifikasi`,
    `Organisasi`, `Proyek` sekarang dikenali sebagai batas section (sebelumnya blok Kemampuan ikut
    tertelan ke Pendidikan). Rentang tanggal dengan nama bulan (`Juni 2023 - Agustus 2023`) kini terbaca,
    rentang kuliah tidak lagi dihitung sebagai pengalaman kerja, dan klaim "N tahun" hanya dihitung kalau
    diikuti kata pengalaman/experience (bukan usia). Kamus skill diperluas (Laravel, MySQL, PostgreSQL,
    Tailwind, dst) dan target job tidak lagi jatuh ke skill mentah seperti "excel": kalau CV tidak punya
    target, posisi diambil dari sebutan posisi di CV atau ditebak dari kombinasi skill.
13. **Launcher browser sadar serverless.** Di Vercel/Lambda, scraper memakai `playwright-core` +
    `@sparticuz/chromium`; di lokal/Docker memakai `playwright` biasa. Ditambah `backend/Dockerfile`.

---

## 1. Struktur folder

```
job-tracker/
├── frontend/        React + Vite
│   └── src/
│       ├── components/   UploadArea, StatusProgress, JobTable, JobDetailModal
│       ├── pages/         Home.jsx (alur utama aplikasi)
│       └── services/      api.js (pemanggilan ke backend)
│
├── backend/          Node.js + Express
│   ├── routes/        cvRoutes.js, jobRoutes.js
│   ├── services/       cvParser.js, matchingService.js, umrService.js
│   ├── scrapers/       glintsScraper.js (Playwright), index.js, scraperUtils.js
│   └── utils/           dateParser.js, salaryParser.js, dedupe.js
│
└── README.md   (file ini)
```

---

## 2. Cara install

Butuh **Node.js versi 18 ke atas**.

### Backend

```bash
cd backend
npm install
npx playwright install chromium   # download browser yang dipakai Playwright
cp .env.example .env
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env
```

---

## 3. Cara menjalankan

Jalankan **backend** dan **frontend** di dua terminal terpisah.

**Terminal 1 - Backend** (default di port 5000):

```bash
cd backend
npm run dev
```

**Terminal 2 - Frontend** (default di port 5173):

```bash
cd frontend
npm run dev
```

Buka browser ke `http://localhost:5173`.

Saat development, frontend otomatis meneruskan request `/api/...` ke backend lewat proxy
Vite (lihat `frontend/vite.config.js`) — jadi kamu tidak perlu setting apa pun tambahan.

---

## 4. Cara pakai aplikasi

1. Di halaman utama, klik **Choose CV** dan pilih file PDF CV kamu.
2. Klik **ANALYZE CV** → sistem membaca CV dan menampilkan hasil parsing (skill, pengalaman,
   pendidikan, target job).
3. Klik **ANALYZE & SEARCH JOB** → sistem mencari lowongan di Glints berdasarkan keyword dari
   CV, lalu memfilter dan menghitung skor kecocokan.
4. Hasil **Top 10** lowongan ditampilkan dalam tabel. Klik salah satu baris untuk melihat detail.
5. Klik **NEW SEARCH** kapan saja untuk mengulang dari awal (menghapus semua data di memory).

---

## 5. Cara testing scraper secara terpisah

Karena Playwright membutuhkan browser dan environment backend, kamu bisa mengetes scraper
Glints tanpa menyalakan frontend:

```bash
cd backend
npm run test-scraper -- "Data Analyst"
```

Ini akan menjalankan `scrapers/testScraper.js` dan mencetak beberapa hasil mentah ke terminal.
Berguna untuk mengecek apakah selector di `glintsScraper.js` masih cocok dengan struktur
halaman Glints saat ini.

---

## 6. Penjelasan bagian penting

- **CV Parser (`backend/services/cvParser.js`)** — memakai `pdf-parse` untuk membaca teks PDF, lalu
  mengekstrak skill, pengalaman, pendidikan, target job, dan domisili berdasarkan section/label CV
  dengan pencocokan word-boundary (`utils/textMatch.js`). Juga mengekstrak taksiran lama pengalaman
  kerja (`experienceYears`), level senioritas kasar (`seniority`), dan frekuensi skill (`skillFrequency`).

- **Scraper Glints (`backend/scrapers/glintsScraper.js`)** — memakai Playwright untuk membuka
  halaman pencarian publik Glints (tanpa login), lalu mengambil data lowongan (termasuk cuplikan
  deskripsi dari kartu listing). Selector CSS dikumpulkan di satu tempat (`SELECTORS`) supaya
  mudah diperbarui kalau struktur halaman Glints berubah. Scraper menunggu elemen benar-benar
  muncul (bukan jeda tetap), retry ringan untuk kegagalan jaringan sementara, mendeteksi halaman
  blokir/captcha secara eksplisit, dan memberi jeda antar-request yang diacak (jitter) supaya
  tidak membebani server Glints. `fetchDescriptionsForJobs()` mengambil deskripsi LENGKAP dari
  halaman detail, tapi hanya untuk kandidat-kandidat teratas (`DESCRIPTION_ENRICH_LIMIT`), bukan
  semua job, supaya tetap ramah ke server Glints.

- **Date Parser (`backend/utils/dateParser.js`)** — mengubah teks tanggal seperti "2 days ago"
  atau "21 Sep 2026" menjadi format standar `YYYY-MM-DD`, lalu dipakai untuk memfilter lowongan
  yang diposting maksimal `MAX_POSTING_AGE_DAYS` hari terakhir (default 5).

- **Salary Parser (`backend/utils/salaryParser.js`)** — mengubah format gaji Indonesia seperti
  `4.5 jt`, `4,5 juta`, dan rentang ber-Rupiah menjadi angka `minSalary` dan `maxSalary`.

- **Location Utils (`backend/utils/locationUtils.js`)** — normalisasi nama lokasi dan skor
  kemiripan lokasi yang granular (remote, satu area metro, satu provinsi, hybrid, dll), dipakai
  bersama oleh `umrService.js` dan `matchingService.js`.

- **UMR Service (`backend/services/umrService.js`)** — mengambil UMK/UMP dari API/sumber
  terpercaya (env `UMR_API_URL`, opsional, dengan cache 24 jam), dengan fallback ke tabel statis
  kalau API tidak diisi/gagal diakses. Kalau lokasi benar-benar tidak dikenali, statusnya
  `UNKNOWN` secara eksplisit (bukan menebak diam-diam). **Silakan update tabel statis** dengan
  data resmi terbaru dari Kemnaker / Dinas Tenaga Kerja setempat kalau tidak memakai `UMR_API_URL`.

- **Matching Service (`backend/services/matchingService.js`)** — menghitung skor kecocokan CV
  dengan lowongan (title + deskripsi lengkap kalau tersedia) berdasarkan bobot: skill 32%,
  pengalaman (posisi) 25%, posisi/keyword 18%, lokasi 10%, gaji vs UMR 7%, lama pengalaman 8%.
  Skor gaji & lokasi bertingkat (graduated), bukan biner.

---

## 7. Batasan MVP ini

- Hanya mendukung sumber **Glints** (struktur scraper sudah modular untuk menambah sumber lain
  seperti Jobstreet, LinkedIn, dll di kemudian hari — lihat `backend/scrapers/index.js`).
- Data UMR memakai tabel statis sebagai fallback; kalau ingin sumber yang selalu ter-update,
  isi env `UMR_API_URL` dengan API/dataset UMR terpercaya yang mengembalikan format JSON
  `{ "nama daerah": angka, ... }`.
- Tidak ada database — semua hasil hilang setiap kali backend di-restart atau user klik
  **NEW SEARCH**.
- Kalau struktur halaman Glints berubah total, scraper masih bisa gagal mengambil data (sudah
  lebih tahan banting, tapi tidak kebal 100%). Kalau itu terjadi, cek pesan error dulu — sekarang
  sudah dibedakan antara "selector tidak cocok" vs "kemungkinan diblokir/captcha" — lalu update
  daftar `SELECTORS` di `backend/scrapers/glintsScraper.js` sesuai struktur HTML terbaru (cek
  lewat DevTools browser).
- Deskripsi lengkap lowongan hanya diambil untuk `DESCRIPTION_ENRICH_LIMIT` kandidat teratas per
  pencarian (default 25), bukan semua lowongan yang ditemukan, supaya tidak membebani Glints.
  Lowongan di luar itu tetap ikut diberi skor, hanya saja pakai cuplikan deskripsi dari listing
  (kalau ada) alih-alih deskripsi lengkap.

---

## 8. Environment tambahan untuk deployment

Backend mendukung beberapa env tambahan:

```env
MAX_CONCURRENT_SEARCHES=1
CORS_ORIGIN=http://localhost:5173
```

`CORS_ORIGIN` boleh berisi beberapa origin dipisahkan koma. Kalau kosong, server tetap mengizinkan
request browser dari origin apa pun selama tidak memakai credentials. `MAX_CONCURRENT_SEARCHES` sebaiknya
tetap kecil karena setiap pencarian menggunakan Playwright/Chromium.

---

## 9. Deployment

- **Frontend**: bisa langsung di-deploy ke **Vercel** (`frontend/` sebagai root project).
  Set environment variable `VITE_API_BASE_URL` ke URL backend yang sudah online.
- **Backend**: karena memakai Playwright (butuh browser Chromium), backend **tidak bisa**
  di-deploy sebagai serverless function biasa. Deploy ke service Node.js yang mendukung
  Playwright/browser (misalnya VPS, Railway, Render dengan buildpack yang mendukung Playwright,
  atau container Docker yang sudah menginstall dependency Chromium).
- Scraping dengan Playwright **tidak boleh** dijalankan langsung dari browser React — selalu
  lewat backend Express.

### Opsi A (disarankan): backend di Docker (Render / Railway / Fly.io)

`backend/Dockerfile` sudah menyiapkan Chromium + dependency sistemnya. Deploy folder `backend/` sebagai
Docker service, isi env (`CORS_ORIGIN=https://<domain-frontend-kamu>`), lalu set `VITE_API_BASE_URL` di
Vercel (project frontend) ke URL backend tersebut. Tidak ada batas durasi request seperti di serverless.

### Opsi B: backend tetap di Vercel

Bisa, tapi rapuh. Yang wajib:

1. `cd backend && npm install @sparticuz/chromium playwright-core`, commit `package-lock.json`.
2. Pastikan file binary Chromium ikut ter-bundle ke function. Di `backend/vercel.json`:
   ```json
   {
     "functions": {
       "server.js": {
         "maxDuration": 60,
         "includeFiles": "node_modules/@sparticuz/chromium/**"
       }
     }
   }
   ```
   Sesuaikan `maxDuration` dengan batas plan kamu; kalau Vercel menolak pola `server.js`, cocokkan
   dengan nama function yang muncul di build log.
3. Kecilkan beban satu request supaya muat di batas durasi: `MAX_PAGES_PER_KEYWORD=2`,
   `DESCRIPTION_ENRICH_LIMIT=8`, `SCRAPE_DELAY_MS=800`.
4. Rate limit dan `MAX_CONCURRENT_SEARCHES` bersifat in-memory per instance, jadi tidak berlaku
   lintas instance serverless.
5. IP datacenter (Vercel/AWS) lebih sering kena captcha/blokir dari Glints dibanding VPS biasa.


## 8. Deployment ke Vercel

Arsitektur yang disarankan adalah dua project Vercel: `frontend` sebagai Vite static app dan `backend` sebagai Express app. Backend memakai Playwright + `@sparticuz/chromium`, sehingga beban scraping perlu dibatasi.

### Frontend
- Root Directory: `frontend`
- Framework: Vite
- Build Command: `npm run build`
- Output Directory: `dist`
- Environment Variable: `VITE_API_BASE_URL=https://URL-BACKEND-VERCEL`

### Backend
- Root Directory: `backend`
- Framework: Express
- Build/Install: default Vercel
- Environment Variables yang disarankan untuk Hobby: `NODE_ENV=production`, `CORS_ORIGIN=https://URL-FRONTEND-VERCEL`, `MAX_KEYWORDS=5`, `MAX_PAGES_PER_KEYWORD=1`, `DESCRIPTION_ENRICH_LIMIT=3`, `SCRAPE_DELAY_MS=500`, `MAX_CONCURRENT_SEARCHES=1`, `MAX_POSTING_AGE_DAYS=5`

Jangan mengisi `VITE_API_BASE_URL` production dengan `http://localhost:5000`, karena nilai `VITE_*` tertanam saat build frontend.

Catatan penting: endpoint upload CV lewat Vercel Function terkena batas request body 4,5 MB, sehingga batas Multer 10 MB tidak bisa dipakai penuh di Vercel. Untuk MVP, batasi ukuran CV yang dipilih user ke sekitar 4 MB atau pindahkan upload file ke object storage/client upload.

Endpoint pencarian melakukan browser automation dan streaming progress. Vercel mendukung Express dan streaming, tetapi setiap request tetap mempunyai batas durasi Function; Hobby saat ini maksimal 300 detik dengan Fluid Compute.


## 8. Deploy backend ke Vercel

Untuk repository ini, buat project Vercel khusus backend dan set **Root Directory** ke `backend`.
Pastikan deployment menggunakan Node.js 24.x. Dependency runtime berada di `dependencies`, sedangkan `playwright`
untuk menjalankan Chromium lokal berada di `devDependencies`; environment serverless menggunakan `playwright-core`
+ `@sparticuz/chromium`.

Environment production yang disarankan untuk Vercel Hobby:

```text
NODE_ENV=production
MAX_KEYWORDS=5
MAX_PAGES_PER_KEYWORD=1
DESCRIPTION_ENRICH_LIMIT=3
SCRAPE_DELAY_MS=500
MAX_POSTING_AGE_DAYS=5
MAX_CONCURRENT_SEARCHES=1
CORS_ORIGIN=https://URL-FRONTEND-KAMU.vercel.app
```

Setelah deploy, tes `GET /api/health`. Jika endpoint hidup, tes pencarian job dari frontend.

Setelah deploy backend, buka `https://URL-BACKEND.vercel.app/api/browser-check`. Respons sukses berbentuk JSON
dan menandakan `@sparticuz/chromium` + `playwright-core` berhasil dimuat serta executable Chromium berhasil disiapkan.
Jika muncul error import Chromium, lihat pesan error baru di warning aplikasi karena sekarang kode menampilkan
error module yang sebenarnya, bukan lagi menyebut dependency sekadar “belum terpasang”.
