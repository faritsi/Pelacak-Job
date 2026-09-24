// services/umrService.js
// Tugas file ini: memberikan nilai UMR/UMK/UMP berdasarkan nama daerah,
// lalu membandingkannya dengan gaji minimum sebuah lowongan.
//
// PERUBAHAN PENTING dari versi sebelumnya:
// 1. Sekarang bisa mengambil data dari API/sumber terpercaya yang bisa dikonfigurasi lewat
//    env UMR_API_URL (misal dataset resmi/terbuka yang di-hosting sebagai JSON), dengan cache
//    in-memory (24 jam) supaya tidak fetch berulang-ulang. Kalau UMR_API_URL tidak diisi, atau
//    fetch gagal, sistem otomatis fallback ke tabel statis di bawah (jangan sampai fitur mati
//    total gara-gara satu sumber down).
// 2. Kalau lokasi benar-benar tidak dikenali (tidak ada di hasil API maupun tabel statis, dan
//    tidak bisa ditebak provinsinya), sistem TIDAK LAGI diam-diam memakai angka UMR nasional
//    default. Sekarang status-nya eksplisit "UNKNOWN" — supaya matching score tahu ini bukan
//    perbandingan yang valid, bukan pura-pura tahu.
// 3. checkSalaryAgainstUMR TIDAK dipakai lagi untuk MEMBUANG (reject) lowongan di pipeline
//    utama — cuma untuk memberi skor & informasi ke user. Lihat routes/jobRoutes.js &
//    services/matchingService.js.

const { normalizeLocationName, getProvinceForLocation, isRemoteLocation } = require("../utils/locationUtils");

// ------------------------------------------------------------------------------------
// Tabel statis (fallback). Angka per Januari 2026, HARUS di-update tiap tahun kalau
// UMR_API_URL tidak dipakai. Sumber acuan: SK Gubernur masing-masing provinsi / Kemnaker.
// Kunci provinsi dipakai sebagai fallback kalau kota/kabupaten spesifik tidak ada di tabel.
// ------------------------------------------------------------------------------------
const UMK_TABLE = {
  // Jabodetabek
  "jakarta": 5396760, "jakarta selatan": 5396760, "jakarta pusat": 5396760,
  "jakarta barat": 5396760, "jakarta timur": 5396760, "jakarta utara": 5396760,
  "bekasi": 5690752, "kota bekasi": 5690752, "kabupaten bekasi": 5690752,
  "depok": 4694493, "bogor": 4877211, "kabupaten bogor": 4877211, "kota bogor": 4508507,
  "tangerang": 4650302, "kota tangerang": 4650302, "tangerang selatan": 4700754,
  "kabupaten tangerang": 4650302,
  // Jawa Barat lain
  "bandung": 4482915, "kota bandung": 4482915, "cimahi": 3627880,
  "cirebon": 2517730, "indramayu": 2540994, "karawang": 5762535, "purwakarta": 4700302,
  // Jawa Tengah & DIY
  "semarang": 3454827, "kota semarang": 3454827, "solo": 2352995, "surakarta": 2352995,
  "yogyakarta": 2492997, "sleman": 2315976, "bantul": 2216480,
  // Jawa Timur
  "surabaya": 4961753, "sidoarjo": 4791843, "gresik": 4771044, "malang": 3441768,
  // Bali & lainnya
  "denpasar": 3007067, "badung": 3318628,
  "medan": 3623000, "palembang": 3540000, "makassar": 3700000,
  "balikpapan": 3450000, "samarinda": 3400000,
};

// UMP per provinsi (dipakai kalau kota spesifik tidak ada, tapi provinsinya kebaca)
const UMP_TABLE = {
  "dki jakarta": 5396760,
  "jawa barat": 2408905,
  "banten": 2905119,
  "jawa tengah": 2169349,
  "di yogyakarta": 2264080,
  "jawa timur": 2305984,
  "bali": 2996560,
  "sumatera utara": 2809915,
  "sumatera selatan": 3456874,
  "sulawesi selatan": 3657527,
  "kalimantan timur": 3579314,
};

const NATIONAL_FALLBACK = 3113359; // dipakai HANYA sebagai penanda kasar kalau benar2 tidak ada info provinsi

// ------------------------------------------------------------------------------------
// Sumber eksternal (opsional) via API/sumber terpercaya. Contoh: dataset terbuka yang
// mem-publish UMK/UMP terbaru dalam format { "kota atau provinsi": angka, ... }.
// Diisi lewat env UMR_API_URL supaya gampang diganti kalau ada API resmi pemerintah nanti.
// ------------------------------------------------------------------------------------
const UMR_API_URL = process.env.UMR_API_URL || "";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 jam
let apiCache = { data: null, fetchedAt: 0 };

async function fetchUMRFromAPI() {
  if (!UMR_API_URL) return null;

  const isFresh = apiCache.data && Date.now() - apiCache.fetchedAt < CACHE_TTL_MS;
  if (isFresh) return apiCache.data;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(UMR_API_URL, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) throw new Error(`Status HTTP ${response.status}`);
    const json = await response.json();

    // Normalisasi semua key dari sumber eksternal supaya konsisten dengan tabel statis
    const normalized = {};
    for (const [key, value] of Object.entries(json || {})) {
      const numeric = typeof value === "number" ? value : parseInt(String(value).replace(/[^\d]/g, ""), 10);
      if (Number.isFinite(numeric) && numeric > 0) {
        normalized[normalizeLocationName(key)] = numeric;
      }
    }

    apiCache = { data: normalized, fetchedAt: Date.now() };
    return normalized;
  } catch (error) {
    console.warn(`[umrService] Gagal mengambil data UMR dari UMR_API_URL: ${error.message}. Fallback ke tabel statis.`);
    return null; // biarkan fallback ke tabel statis, jangan bikin seluruh app gagal
  }
}

/**
 * getUMR
 * Cari nilai UMR untuk sebuah lokasi. Urutan pencarian:
 * 1. API eksternal (kalau UMR_API_URL diset & datanya berhasil diambil) - exact lalu partial match
 * 2. Tabel UMK statis (kota/kabupaten spesifik) - exact lalu partial match
 * 3. Tabel UMP statis (level provinsi, kalau provinsinya bisa ditebak dari nama kota)
 * 4. Kalau semua gagal -> return null (artinya "unknown", BUKAN 0 dan bukan default nasional diam-diam)
 *
 * @param {string} location
 * @returns {Promise<{ umr: number|null, source: "api"|"umk"|"ump"|"unknown" }>}
 */
async function getUMR(location) {
  if (isRemoteLocation(location)) {
    return { umr: null, source: "unknown" }; // remote job tidak punya UMR daerah yang relevan
  }

  const key = normalizeLocationName(location);
  if (!key) return { umr: null, source: "unknown" };

  // Exact match selalu diprioritaskan. Partial match hanya boleh memilih key terpanjang
  // dan hanya kalau key tersebut mencakup mayoritas nama lokasi, supaya
  // "bandung barat" tidak salah dipetakan ke "bandung".
  const findBestMatch = (table) => {
    if (!table) return null;
    if (table[key] !== undefined) return key;

    const candidates = Object.keys(table)
      .filter((candidate) => key.includes(candidate) || candidate.includes(key))
      .sort((a, b) => b.length - a.length);

    for (const candidate of candidates) {
      const ratio = Math.min(candidate.length, key.length) / Math.max(candidate.length, key.length);
      if (ratio >= 0.72) return candidate;
    }
    return null;
  };

  // 1. API eksternal
  const apiData = await fetchUMRFromAPI();
  if (apiData) {
    const foundKey = findBestMatch(apiData);
    if (foundKey) return { umr: apiData[foundKey], source: "api" };
  }

  // 2. Tabel UMK statis
  const foundUmkKey = findBestMatch(UMK_TABLE);
  if (foundUmkKey) return { umr: UMK_TABLE[foundUmkKey], source: "umk" };

  // 3. Tabel UMP statis (fallback provinsi)
  const province = getProvinceForLocation(key);
  if (province && UMP_TABLE[province] !== undefined) {
    return { umr: UMP_TABLE[province], source: "ump" };
  }

  // 4. Benar-benar tidak dikenali -> unknown (bukan menebak angka nasional secara diam-diam)
  return { umr: null, source: "unknown" };
}

/**
 * checkSalaryAgainstUMR
 * CATATAN: hasil "REJECT" di sini TIDAK BOLEH dipakai untuk membuang/menghapus lowongan dari
 * hasil pencarian. Cukup dipakai sebagai salah satu komponen skor & info transparansi ke user
 * (lihat matchingService.js). Kalau ingin tetap tahu "nilai kasar" saat unknown, gunakan
 * NATIONAL_FALLBACK hanya untuk tampilan referensi, bukan untuk keputusan filter.
 *
 * @param {number|null} salaryMin
 * @param {string} location
 * @returns {Promise<{ umr: number|null, status: "PASS"|"REJECT"|"UNKNOWN", umrSource: string }>}
 */
async function checkSalaryAgainstUMR(salaryMin, location) {
  const { umr, source } = await getUMR(location);

  if (salaryMin === null || salaryMin === undefined || umr === null) {
    return { umr, status: "UNKNOWN", umrSource: source };
  }

  return { umr, status: salaryMin >= umr ? "PASS" : "REJECT", umrSource: source };
}

module.exports = { getUMR, checkSalaryAgainstUMR, NATIONAL_FALLBACK };
