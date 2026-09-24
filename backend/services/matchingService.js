// services/matchingService.js
// Tugas file ini: menghitung skor kecocokan antara CV (skills, experience, keywords)
// dengan sebuah lowongan kerja. Menggunakan keyword matching sederhana (belum AI).
//
// PERUBAHAN PENTING dari versi sebelumnya:
// 1. skillScore & experienceScore dulu HANYA dicocokkan ke `job.title` (deskripsi job tidak
//    pernah dikirim ke fungsi ini, bahkan scraper-nya dulu tidak pernah mengambil deskripsi
//    sama sekali). Akibatnya CV dengan skill "excel", "sql", "data analyst" bisa dapat skor
//    rendah untuk lowongan yang judulnya generic ("Staff Operasional") padahal isi
//    deskripsinya sangat relevan. Sekarang job.description (kalau tersedia — lihat
//    scrapers/glintsScraper.js `fetchDescriptionsForJobs`) ikut dipakai, dengan bobot title
//    lebih tinggi daripada description (karena title lebih presisi, description lebih luas).
// 2. locationScore dulu biner (0 atau 1, exact/substring match). Sekarang granular lewat
//    utils/locationUtils (remote=1, satu area metro=0.75, satu provinsi=0.5, hybrid=0.2, dst).
// 3. salaryScore dulu selalu 1 untuk semua job yang sampai ke fungsi ini, karena job dengan
//    status REJECT sudah "dibuang" duluan di jobRoutes.js sebelum matching — jadi skor 5% ini
//    dulu sebenarnya tidak pernah membedakan apa pun. Sekarang jobRoutes.js TIDAK membuang job
//    ber-status REJECT, dan salaryScore di sini dihitung bertingkat (rasio gaji terhadap UMR),
//    supaya job dengan gaji jauh di bawah UMR tetap bisa terlihat tapi skornya lebih rendah,
//    bukan hilang sama sekali.
// 4. Menambahkan komponen kecil experienceYearsScore: membandingkan lama pengalaman kerja user
//    (cvData.experienceYears, hasil ekstraksi cvParser) dengan syarat pengalaman yang disebut di
//    deskripsi lowongan (kalau ada), supaya "pengalaman" tidak hanya dicocokkan lewat nama posisi.

const { wordBoundaryIncludes } = require("../utils/textMatch");
const { locationSimilarity } = require("../utils/locationUtils");

const WEIGHTS = {
  skill: 0.32,
  experience: 0.25,
  position: 0.18,
  location: 0.1,
  salary: 0.07,
  experienceYears: 0.08,
};

// Kelompok kata yang dianggap "berkaitan" satu sama lain.
// Ini membantu supaya "data analyst" cocok dengan "analyst data" atau "data analysis".
const SYNONYM_GROUPS = [
  ["data analyst", "data analysis", "analyst data", "data analytics"],
  ["admin", "administrasi", "data entry", "admin data"],
  ["it support", "technical support", "helpdesk", "support"],
  ["reporting", "report", "laporan"],
  ["business analyst", "business support", "data support"],
];

function normalizeText(text) {
  return (text || "").toLowerCase().trim();
}

/**
 * Cek apakah dua string "berkaitan" - exact match, salah satu mengandung yang lain (sebagai
 * unit kata, bukan potongan huruf), atau ada di grup sinonim yang sama.
 */
function isRelated(a, b) {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (wordBoundaryIncludes(na, nb) || wordBoundaryIncludes(nb, na)) return true;

  for (const group of SYNONYM_GROUPS) {
    const inA = group.some((g) => na.includes(g) || g.includes(na));
    const inB = group.some((g) => nb.includes(g) || g.includes(nb));
    if (inA && inB) return true;
  }
  return false;
}

/**
 * Cek keterkaitan sebuah kata (mis. skill) terhadap gabungan beberapa field job (title +
 * description), dengan bobot berbeda per field supaya title tetap lebih "berat".
 * Mengembalikan skor parsial 0..1, bukan boolean, supaya match di description (lebih longgar)
 * tidak dianggap sama kuatnya dengan match di title (lebih presisi).
 */
function relatedScoreAgainstFields(term, fields) {
  let best = 0;
  for (const { text, weight } of fields) {
    if (!text) continue;
    if (isRelated(term, text)) {
      best = Math.max(best, weight);
    } else if (wordBoundaryIncludes(text, term)) {
      best = Math.max(best, weight);
    }
  }
  return best;
}

/**
 * Hitung rata-rata skor overlap antara daftar kata (listA, mis. skill CV) terhadap gabungan
 * field job. Menggantikan overlapScore versi lama yang cuma menerima 1 string gabungan.
 */
function overlapScoreAgainstFields(listA, fields) {
  if (!listA || listA.length === 0) return 0;
  let total = 0;
  for (const term of listA) {
    total += relatedScoreAgainstFields(term, fields);
  }
  return total / listA.length;
}

/**
 * Coba tebak syarat lama pengalaman (dalam tahun) yang disebut di deskripsi lowongan.
 * Contoh yang tertangkap: "minimal 2 tahun pengalaman", "at least 3 years of experience".
 * @returns {number|null}
 */
function extractRequiredYearsFromDescription(description) {
  if (!description) return null;
  const text = description.toLowerCase();
  const patterns = [
    /(\d{1,2})\s*\+?\s*tahun/,
    /(\d{1,2})\s*\+?\s*years?/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const years = parseInt(match[1], 10);
      if (Number.isFinite(years) && years > 0 && years <= 30) return years;
    }
  }
  return null;
}

/**
 * Skor kecocokan lama pengalaman user vs syarat lowongan (kalau syaratnya tidak diketahui,
 * skor netral 0.5 supaya tidak menghukum job yang deskripsinya tidak menyebutkan angka).
 */
function experienceYearsScore(userYears, requiredYears) {
  if (requiredYears === null || requiredYears === undefined) return 0.5;
  if (!userYears || userYears <= 0) return requiredYears <= 1 ? 0.6 : 0.15;
  if (userYears >= requiredYears) return 1;
  // Sedikit di bawah syarat masih dikasih skor parsial, bukan langsung 0
  const ratio = userYears / requiredYears;
  return Math.max(0.1, ratio);
}

/**
 * Skor gaji bertingkat (bukan biner). Kalau UMR daerahnya tidak diketahui, skor netral.
 * Kalau gaji tidak diketahui, skor netral juga (bukan 0 — supaya lowongan tanpa info gaji
 * eksplisit tidak otomatis dianggap "gagal").
 */
function graduatedSalaryScore(salaryMin, umr, salaryStatus) {
  if (salaryStatus === "UNKNOWN" || !umr || salaryMin === null || salaryMin === undefined) {
    return 0.5;
  }
  const ratio = salaryMin / umr;
  if (ratio >= 1) return 1; // PASS: gaji >= UMR
  // REJECT tapi masih dikasih skor parsial proporsional, bukan 0 total, karena selisih
  // sedikit di bawah UMR beda jauh dari gaji yang sangat rendah.
  return Math.max(0, Math.min(0.9, ratio));
}

/**
 * calculateMatchScore
 * @param {object} cvData - { skills: [], experience: [], keywords: [], experienceYears }
 * @param {object} job - { title, description, location, salaryMin, umr, salaryStatus }
 * @param {string} userLocation - lokasi yang diinginkan user (opsional, boleh null)
 * @returns {{ score: number, matchedSkills: string[], breakdown: object }}
 */
function calculateMatchScore(cvData, job, userLocation = null) {
  const fields = [
    { text: job.title || "", weight: 1 },
    { text: job.description || "", weight: 0.7 }, // description tetap dihitung walau bobotnya < title
  ];

  const skillScore = overlapScoreAgainstFields(cvData.skills, fields);
  const experienceScore = overlapScoreAgainstFields(cvData.experience, fields);
  const positionTerms = Array.isArray(cvData.targetJobs) && cvData.targetJobs.length > 0
    ? cvData.targetJobs
    : cvData.keywords;
  const positionScore = overlapScoreAgainstFields(positionTerms, fields);

  const locationScore = locationSimilarity(userLocation, job.location);

  const salaryScore = graduatedSalaryScore(job.salaryMin, job.umr, job.salaryStatus);

  const requiredYears = extractRequiredYearsFromDescription(job.description);
  const expYearsScore = experienceYearsScore(cvData.experienceYears, requiredYears);

  const totalScore =
    skillScore * WEIGHTS.skill +
    experienceScore * WEIGHTS.experience +
    positionScore * WEIGHTS.position +
    locationScore * WEIGHTS.location +
    salaryScore * WEIGHTS.salary +
    expYearsScore * WEIGHTS.experienceYears;

  // Daftar skill CV yang cocok dengan judul ATAU deskripsi lowongan (untuk ditampilkan di detail)
  const matchedSkills = (cvData.skills || []).filter(
    (skill) => relatedScoreAgainstFields(skill, fields) > 0
  );

  return {
    score: Math.round(totalScore * 100), // dalam persen (0-100)
    matchedSkills,
    breakdown: {
      skillScore: Math.round(skillScore * 100),
      experienceScore: Math.round(experienceScore * 100),
      positionScore: Math.round(positionScore * 100),
      locationScore: Math.round(locationScore * 100),
      salaryScore: Math.round(salaryScore * 100),
      experienceYearsScore: Math.round(expYearsScore * 100),
      requiredYears,
    },
  };
}

module.exports = { calculateMatchScore, isRelated, extractRequiredYearsFromDescription };
