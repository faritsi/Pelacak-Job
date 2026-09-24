// utils/locationUtils.js
// Normalisasi + similarity lokasi untuk matching dan lookup UMR.

const PREFIX_WORDS = ["kota administrasi", "kota", "kabupaten", "kab.", "kab", "provinsi", "prov."];
const REMOTE_KEYWORDS = ["remote", "wfh", "work from home", "work from anywhere", "anywhere"];
const HYBRID_KEYWORDS = ["hybrid"];

const METRO_GROUPS = [
  ["jakarta", "jakarta selatan", "jakarta pusat", "jakarta barat", "jakarta timur", "jakarta utara", "bekasi", "depok", "bogor", "tangerang", "tangerang selatan"],
  ["bandung", "bandung barat", "cimahi", "sumedang", "subang", "garut", "tasikmalaya", "sukabumi", "majalengka", "kuningan", "kabupaten bandung"],
  ["surabaya", "sidoarjo", "gresik"],
  ["semarang", "kabupaten semarang"],
  ["yogyakarta", "sleman", "bantul"],
];

const CITY_TO_PROVINCE = {
  "jakarta": "dki jakarta", "jakarta selatan": "dki jakarta", "jakarta pusat": "dki jakarta",
  "jakarta barat": "dki jakarta", "jakarta timur": "dki jakarta", "jakarta utara": "dki jakarta",
  "bekasi": "jawa barat", "kabupaten bekasi": "jawa barat", "depok": "jawa barat",
  "bogor": "jawa barat", "kabupaten bogor": "jawa barat", "bandung": "jawa barat",
  "bandung barat": "jawa barat", "kabupaten bandung": "jawa barat", "cimahi": "jawa barat",
  "cirebon": "jawa barat", "indramayu": "jawa barat", "karawang": "jawa barat", "purwakarta": "jawa barat",
  "sumedang": "jawa barat", "subang": "jawa barat", "garut": "jawa barat", "tasikmalaya": "jawa barat",
  "sukabumi": "jawa barat", "majalengka": "jawa barat", "kuningan": "jawa barat",
  "tangerang": "banten", "tangerang selatan": "banten", "kabupaten tangerang": "banten", "serang": "banten",
  "semarang": "jawa tengah", "solo": "jawa tengah", "surakarta": "jawa tengah",
  "yogyakarta": "di yogyakarta", "sleman": "di yogyakarta", "bantul": "di yogyakarta",
  "surabaya": "jawa timur", "sidoarjo": "jawa timur", "gresik": "jawa timur", "malang": "jawa timur",
  "denpasar": "bali", "badung": "bali", "medan": "sumatera utara", "palembang": "sumatera selatan",
  "makassar": "sulawesi selatan", "balikpapan": "kalimantan timur", "samarinda": "kalimantan timur",
};

function normalizeLocationName(raw) {
  let s = String(raw || "").toLowerCase().trim();
  if (!s) return "";

  // Ambil bagian lokasi utama sebelum provinsi/negara tambahan.
  s = s.split(/[|;\n]/)[0];
  if (s.includes(",")) s = s.split(",")[0];
  s = s.replace(/\([^)]*\)/g, " ");
  s = s.replace(/\s+/g, " ").trim();

  for (const prefix of PREFIX_WORDS) {
    const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b\\s*`, "i");
    s = s.replace(re, "");
  }

  return s.replace(/\s+/g, " ").trim();
}

function isRemoteLocation(raw) {
  const s = String(raw || "").toLowerCase();
  return REMOTE_KEYWORDS.some((k) => s.includes(k));
}

function isHybridLocation(raw) {
  const s = String(raw || "").toLowerCase();
  return HYBRID_KEYWORDS.some((k) => s.includes(k));
}

function phraseMatches(candidate, key) {
  if (!candidate || !key) return false;
  if (candidate === key) return true;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`, "i");
  return re.test(candidate);
}

function findMetroGroup(key) {
  return METRO_GROUPS.find((group) => group.some((city) => phraseMatches(key, city) || phraseMatches(city, key)));
}

function getProvinceForLocation(raw) {
  const key = normalizeLocationName(raw);
  if (!key) return null;
  if (CITY_TO_PROVINCE[key]) return CITY_TO_PROVINCE[key];

  // Pilih city token TERPANJANG yang benar-benar phrase-match, bukan substring pertama.
  const candidates = Object.keys(CITY_TO_PROVINCE)
    .filter((city) => phraseMatches(key, city))
    .sort((a, b) => b.length - a.length);
  return candidates.length ? CITY_TO_PROVINCE[candidates[0]] : null;
}

function locationSimilarity(userLocation, jobLocation) {
  if (!userLocation) return 0.5;
  if (isRemoteLocation(jobLocation)) return 1;

  const a = normalizeLocationName(userLocation);
  const b = normalizeLocationName(jobLocation);
  if (!a || !b) return 0.5;

  if (a === b) return isHybridLocation(jobLocation) ? 0.9 : 1;

  const metroGroup = findMetroGroup(a);
  if (metroGroup && metroGroup.some((city) => phraseMatches(b, city) || phraseMatches(city, b))) {
    return isHybridLocation(jobLocation) ? 0.65 : 0.75;
  }

  const provinceA = getProvinceForLocation(a);
  const provinceB = getProvinceForLocation(b);
  if (provinceA && provinceB && provinceA === provinceB) {
    return isHybridLocation(jobLocation) ? 0.35 : 0.5;
  }

  if (isHybridLocation(jobLocation)) return 0.2;
  return 0;
}

module.exports = {
  normalizeLocationName,
  isRemoteLocation,
  isHybridLocation,
  getProvinceForLocation,
  locationSimilarity,
  CITY_TO_PROVINCE,
  METRO_GROUPS,
};
