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
14. **Fix error `Target page, context or browser has been closed`.** Launcher sekarang menggunakan `launchPersistentContext()`
    per request dan tidak lagi membuat BrowserContext kedua dengan `browser.newContext()`.
15. **Scraper Glints dipindah dari selector HTML lama ke GraphQL search.** Pencarian sekarang memakai `searchJobsV3`
    dari dalam browser Playwright, sehingga tidak bergantung pada class `JobCard` dan pagination DOM lama.
    Tanggal posting diambil langsung dari `createdAt`, sehingga filter 5 hari tidak bergantung pada teks tanggal di kartu.
16. **Fix Docker production dependency.** `playwright` dipindah dari `devDependencies` ke `dependencies` karena
    image production menjalankan Chromium Playwright saat runtime.
17. **Konfigurasi Vercel ditambahkan.** `backend/vercel.json` mengatur `maxDuration` dan bundling
    `@sparticuz/chromium`.

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

Butuh **Node.js 24.x** (sesuai `engines` di `backend/package.json`).

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
Berguna untuk mengecek apakah GraphQL endpoint Glints dan browser runtime dapat diakses.
Untuk test parser tanpa internet/browser:

```bash
node scrapers/testGlintsParser.js
```

---

## 6. Penjelasan bagian penting

- **CV Parser (`backend/services/cvParser.js`)** — memakai `pdf-parse` untuk membaca teks PDF, lalu
  mengekstrak skill, pengalaman, pendidikan, target job, dan domisili berdasarkan section/label CV
  dengan pencocokan word-boundary (`utils/textMatch.js`). Juga mengekstrak taksiran lama pengalaman
  kerja (`experienceYears`), level senioritas kasar (`seniority`), dan frekuensi skill (`skillFrequency`).

- **Scraper Glints (`backend/scrapers/glintsScraper.js`)** — memakai Playwright sebagai browser
  runtime, tetapi pencarian utama tidak lagi membaca kartu HTML. Scraper mengirim query
  `searchJobsV3` ke GraphQL Glints dari dalam page browser, mengambil `title/company/city/salary/createdAt`,
  lalu membuat URL detail job. Ini membuat pencarian tidak tergantung class CSS dan pagination DOM lama.
  Request transient pada browser di-retry, pencarian memakai persistent context per request, dan
  `fetchDescriptionsForJobs()` tetap membuka halaman detail publik untuk kandidat teratas saja.

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
- Endpoint GraphQL Glints yang dipakai scraper adalah endpoint internal/undocumented dan dapat
  berubah tanpa pemberitahuan. Bila Glints mengubah schema `searchJobsV3`, parser GraphQL perlu
  diperbarui.
- WAF/rate-limit Glints tetap dapat menolak request. Aplikasi tidak melakukan bypass CAPTCHA; error
  ditampilkan sebagai warning daripada dipalsukan menjadi "0 lowongan".
- Deskripsi lengkap lowongan hanya diambil untuk `DESCRIPTION_ENRICH_LIMIT` kandidat teratas per
  pencarian (default 3 pada konfigurasi ini), bukan semua lowongan yang ditemukan.

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

- **Frontend**: deploy `frontend/` sebagai project Vercel/Vite dan set `VITE_API_BASE_URL` ke URL backend.
- **Backend**: bisa dijalankan di Docker/VM atau Vercel serverless. Untuk Vercel, scraper menggunakan
  `playwright-core` + `@sparticuz/chromium`; untuk local/Docker, `playwright` biasa.
- Scraping tetap dijalankan di backend, bukan dari React browser.

### Opsi A: backend Docker (Render / Railway / Fly.io / VPS)

`backend/Dockerfile` menginstall Chromium + dependency sistem. Deploy folder `backend/` sebagai service Node/Docker
dan isi `CORS_ORIGIN=https://<domain-frontend-kamu>`. Karena browser berjalan persistent context per request,
set `MAX_CONCURRENT_SEARCHES` tetap kecil (umumnya 1).

### Opsi B: backend Vercel

Repository sudah menyertakan `backend/vercel.json` untuk mengatur `maxDuration` dan memastikan file `@sparticuz/chromium`
ikut dibundle. Root Directory project backend = `backend`, Node.js = 24.x. Gunakan konfigurasi ringan: `MAX_KEYWORDS=5`,
`MAX_PAGES_PER_KEYWORD=1`, `DESCRIPTION_ENRICH_LIMIT=3`, `SCRAPE_DELAY_MS=500`, `MAX_CONCURRENT_SEARCHES=1`.

Jangan mengisi `VITE_API_BASE_URL` production dengan `http://localhost:5000`. Untuk upload CV, perhatikan batas request
body platform serverless; bila file CV besar, lebih aman pakai storage/client upload.

### Test setelah deploy

```bash
cd backend
npm run test-scraper -- "Data Analyst"
node scrapers/testGlintsParser.js
```

`testGlintsParser.js` tidak butuh internet dan hanya memvalidasi transformasi data. `testScraper.js` memvalidasi
akses runtime nyata ke Glints dari environment tempat backend berjalan.

> Catatan: endpoint GraphQL yang dipakai pencarian Glints adalah endpoint internal/undocumented yang terlihat dipakai
> oleh halaman search. Endpoint ini dapat berubah dan dapat dilindungi WAF/rate-limit; aplikasi tidak melakukan bypass.
