// services/cvParser.js
// Rule-based CV parser. Fokus utama: jangan mencampur target pekerjaan/summary
// dengan pengalaman kerja aktual, karena hasil parser langsung dipakai untuk ranking.

const pdfParse = require("pdf-parse");
const { wordBoundaryIncludes, countOccurrences, buildPhraseRegex } = require("../utils/textMatch");

const SKILL_DICTIONARY = [
  // Office / data
  "excel", "microsoft word", "microsoft powerpoint", "microsoft office", "google sheets",
  "sql", "python", "data analysis", "data cleaning", "data visualization", "reporting",
  "power bi", "tableau", "looker studio", "google analytics", "vba", "data entry", "etl",
  "machine learning", "statistik", "statistics", "r programming",
  // Database
  "mysql", "postgresql", "oracle", "mongodb", "sql server", "firebase",
  // Web / software
  "javascript", "typescript", "react", "vue", "next.js", "node.js", "html", "css",
  "tailwind css", "bootstrap", "php", "laravel", "codeigniter", "java", "kotlin", "flutter",
  "django", "flask", "c++", "c#", "rest api", "git", "github", "docker", "linux", "wordpress",
  "postman", "jira",
  // Design
  "figma", "photoshop", "canva",
  // Bisnis / operasional
  "customer service", "administrasi", "accounting", "akuntansi",
  "digital marketing", "seo", "social media", "content writing",
  "project management", "warehouse management", "inventory", "logistik", "supply chain",
  "erp", "sap",
];

// Variasi penulisan -> nama skill baku di SKILL_DICTIONARY.
const SKILL_ALIASES = {
  "microsoft excel": "excel",
  "ms excel": "excel",
  "ms office": "microsoft office",
  "ms word": "microsoft word",
  "ms powerpoint": "microsoft powerpoint",
  "tailwind": "tailwind css",
  "tailwindcss": "tailwind css",
  "postgres": "postgresql",
  "reactjs": "react",
  "react.js": "react",
  "nodejs": "node.js",
  "node js": "node.js",
  "vuejs": "vue",
  "vue.js": "vue",
  "nextjs": "next.js",
  "analisis data": "data analysis",
  "data analis": "data analysis",
};

const POSITION_DICTIONARY = [
  "data analyst", "data scientist", "data entry", "admin", "administrasi", "it support",
  "business analyst", "reporting analyst", "mis", "customer service",
  "marketing", "digital marketing", "sales", "accounting staff",
  "finance staff", "hr staff", "human resources", "warehouse staff",
  "logistics staff", "software engineer", "software developer", "web developer",
  "backend developer", "frontend developer", "full stack developer", "mobile developer",
  "programmer", "qa engineer", "system analyst", "database administrator",
  "designer", "ui/ux designer", "content writer", "social media specialist", "project manager",
];

// Variasi penulisan posisi -> nama posisi baku (dipakai juga sebagai keyword pencarian).
const POSITION_ALIASES = {
  "data analis": "data analyst",
  "analis data": "data analyst",
  "back end developer": "backend developer",
  "front end developer": "frontend developer",
  "fullstack developer": "full stack developer",
  "web programmer": "web developer",
  "pengembang web": "web developer",
  "staff admin": "admin",
  "staf administrasi": "administrasi",
};

// Kalau CV tidak menyebut target/posisi sama sekali, tebak arah karier dari skill.
// Ini HANYA dipakai untuk keyword pencarian (bukan untuk skor pengalaman).
const ROLE_FROM_SKILLS = [
  { role: "Frontend Developer", skills: ["react", "vue", "next.js", "html", "css", "tailwind css", "bootstrap", "javascript", "typescript", "figma"], min: 2 },
  { role: "Backend Developer", skills: ["laravel", "php", "node.js", "django", "flask", "codeigniter", "java", "mysql", "postgresql", "rest api"], min: 2 },
  { role: "Data Analyst", skills: ["sql", "python", "excel", "power bi", "tableau", "looker studio", "google sheets", "data analysis", "data visualization", "statistik", "statistics"], min: 2 },
  { role: "Admin", skills: ["microsoft office", "microsoft word", "data entry", "administrasi"], min: 2 },
];

const LOCATION_DICTIONARY = [
  "jakarta selatan", "jakarta pusat", "jakarta barat", "jakarta timur", "jakarta utara", "jakarta",
  "bekasi", "depok", "bogor", "tangerang selatan", "tangerang", "serang",
  "sumedang", "subang", "garut", "tasikmalaya", "sukabumi", "majalengka", "kuningan",
  "bandung barat", "bandung", "cimahi", "cirebon", "indramayu", "karawang", "purwakarta",
  "semarang", "surakarta", "solo", "sleman", "bantul", "yogyakarta",
  "surabaya", "sidoarjo", "gresik", "malang", "denpasar", "badung",
  "medan", "palembang", "makassar", "balikpapan", "samarinda",
];

const PROVINCE_DICTIONARY = [
  "jawa barat", "jawa tengah", "jawa timur", "banten", "dki jakarta", "di yogyakarta", "bali",
  "sumatera utara", "sumatera selatan", "sulawesi selatan", "kalimantan timur",
];

const SECTION_ALIASES = {
  experience: [
    "experience", "work experience", "professional experience", "project experience", "employment history",
    "work history", "pengalaman", "pengalaman kerja", "riwayat pekerjaan", "pengalaman profesional",
    "internship", "magang", "pengalaman magang",
  ],
  education: [
    "education", "educations", "pendidikan", "riwayat pendidikan", "academic background", "pendidikan formal",
  ],
  skills: [
    "skills", "skill", "keahlian", "technical skills", "skills & competencies",
    "kemampuan", "keterampilan", "kompetensi", "soft skill", "soft skills", "hard skill", "hard skills",
    "kemampuan teknis",
  ],
  target: [
    "target job", "target jobs", "target position", "target positions", "desired position",
    "desired job", "position applied", "applying for", "career objective", "objective",
    "posisi yang diinginkan", "posisi dilamar", "pekerjaan yang diinginkan",
  ],
  summary: ["summary", "professional summary", "profile", "profil", "about me", "ringkasan", "tentang saya"],
  // Heading lain yang tidak dipakai parser, tapi WAJIB dikenali sebagai batas section.
  // Tanpa ini, section sebelumnya "bocor" (mis. pendidikan ikut menelan blok Kemampuan).
  other: [
    "certifications", "certification", "certificates", "sertifikasi", "sertifikat",
    "organisasi", "organization", "organizations", "pengalaman organisasi", "organizational experience",
    "projects", "project", "proyek", "portfolio", "portofolio",
    "languages", "language", "bahasa",
    "awards", "penghargaan", "achievements", "prestasi",
    "references", "referensi", "training", "pelatihan", "courses", "kursus",
    "contact", "kontak", "contact information", "personal details", "personal information", "data pribadi", "biodata",
    "interests", "minat", "hobi", "hobbies", "volunteer", "volunteering",
  ],
};

const SECTION_HEADER_SET = new Set(
  Object.values(SECTION_ALIASES).flat().map(normalizeHeading)
);

const EDUCATION_LINE_HINT = /universitas|university|institut|politeknik|sekolah|smk\b|sma\b|gpa|ipk|\bs1\b|\bd3\b|\bd4\b|bachelor|sarjana|jurusan|fakultas/i;

const MONTH_INDEX = {
  jan: 0, feb: 1, mar: 2, apr: 3, mei: 4, may: 4, jun: 5, jul: 6,
  agu: 7, agt: 7, aug: 7, sep: 8, okt: 9, oct: 9, nov: 10, des: 11, dec: 11,
};
const MONTH_RE = "(?:jan(?:uari|uary)?|feb(?:ruari|ruary)?|mar(?:et|ch)?|apr(?:il)?|mei|may|jun(?:i|e)?|jul(?:i|y)?|agu(?:stus)?|agt|aug(?:ust)?|sep(?:t(?:ember)?)?|okt(?:ober)?|oct(?:ober)?|nov(?:ember)?|des(?:ember)?|dec(?:ember)?)";
// Cocok: "2021 - 2023", "Juni 2023 - Agustus 2023", "Jan 2022 – Sekarang", "2020 s/d 2022"
const DATE_RANGE_SOURCE =
  `(?:(${MONTH_RE})\\.?\\s+)?((?:19|20)\\d{2})\\s*(?:[-–—]|\\bto\\b|sampai|s\\/d|hingga)\\s*` +
  `(?:(?:(${MONTH_RE})\\.?\\s+)?((?:19|20)\\d{2})|(sekarang|present|now|current|saat ini))`;

const SENIORITY_KEYWORDS = {
  senior: ["senior", "lead", "manager", "kepala", "koordinator"],
  junior: ["junior", "fresh graduate", "fresh grad", "entry level", "intern", "magang", "trainee"],
};

function normalizeHeading(line) {
  return (line || "")
    .toLowerCase()
    .replace(/[|:•·]+/g, " ")
    .replace(/[^a-z0-9&+\-\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelySectionHeading(line) {
  const normalized = normalizeHeading(line);
  if (!normalized) return false;
  return SECTION_HEADER_SET.has(normalized);
}

/**
 * findSectionRange
 * Cari heading section, lalu ambil baris sesudahnya sampai heading section BERIKUTNYA
 * (apa pun jenisnya, termasuk section yang tidak dipakai parser seperti Sertifikasi).
 * Mengembalikan { lines, indexes } supaya pemanggil tahu baris mana yang milik section ini.
 */
function findSectionRange(lines, aliases) {
  const aliasSet = new Set(aliases.map(normalizeHeading));
  let start = -1;

  for (let i = 0; i < lines.length; i++) {
    if (aliasSet.has(normalizeHeading(lines[i]))) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) return { lines: [], indexes: new Set() };

  const result = [];
  const indexes = new Set();
  for (let i = start; i < lines.length; i++) {
    if (isLikelySectionHeading(lines[i])) break;
    const trimmed = lines[i].trim();
    if (trimmed) {
      result.push(trimmed);
      indexes.add(i);
    }
  }
  return { lines: result, indexes };
}

function findSection(lines, aliases) {
  return findSectionRange(lines, aliases).lines;
}

function linesToText(lines) {
  return (lines || []).join("\n");
}

function guessName(lines) {
  const skipWords = [
    "curriculum vitae", "resume", "cv", "email", "phone", "no.",
    "profile", "profil", "summary", "objective", "experience", "work experience",
    "education", "pendidikan", "skills", "keahlian", "contact", "kontak",
  ];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length < 3 || trimmed.length > 60) continue;
    const lower = trimmed.toLowerCase();
    if (skipWords.some((w) => lower === w || lower.includes(`${w}:`))) continue;
    if (/\d{5,}/.test(trimmed)) continue;
    if (/@/.test(trimmed)) continue;
    return trimmed;
  }
  return "Tidak diketahui";
}

function findMatches(text, dictionary) {
  const found = new Set();
  for (const item of dictionary) {
    if (wordBoundaryIncludes(text, item)) found.add(item);
  }
  return Array.from(found);
}

/** Cari item kamus + alias-nya, kembalikan nama baku (tanpa duplikat), urut sesuai kemunculan pertama di teks. */
function findCanonicalMatches(text, dictionary, aliases) {
  const hits = new Map(); // canonical -> posisi kemunculan pertama
  const consider = (phrase, canonical) => {
    const re = buildPhraseRegex(phrase);
    const m = re.exec(text);
    if (!m) return;
    const prev = hits.get(canonical);
    if (prev === undefined || m.index < prev) hits.set(canonical, m.index);
  };

  for (const item of dictionary) consider(item, item);
  for (const [alias, canonical] of Object.entries(aliases || {})) consider(alias, canonical);

  return [...hits.entries()].sort((a, b) => a[1] - b[1]).map(([name]) => name);
}

function buildSkillFrequency(text, skills) {
  const freq = {};
  for (const skill of skills) freq[skill] = countOccurrences(text, skill);
  return freq;
}

function isEducationLike(line) {
  return EDUCATION_LINE_HINT.test(line);
}

/**
 * Fallback kalau CV tidak punya heading pengalaman: ambil baris di sekitar rentang tanggal,
 * TAPI jangan ambil baris pendidikan/skill, supaya "Sep 2019 - Okt 2024" (kuliah) tidak
 * dihitung sebagai pengalaman kerja.
 */
function inferExperienceText(lines, excludedIndexes = new Set()) {
  const rangeRe = new RegExp(DATE_RANGE_SOURCE, "i");
  const selected = [];

  for (let i = 0; i < lines.length; i++) {
    if (excludedIndexes.has(i)) continue;
    if (!rangeRe.test(lines[i])) continue;
    if (isEducationLike(lines[i])) continue;
    // Kalau baris sebelumnya nama kampus/sekolah, rentang tanggal ini milik pendidikan.
    if (i > 0 && isEducationLike(lines[i - 1])) continue;

    for (let j = Math.max(0, i - 1); j <= Math.min(lines.length - 1, i + 1); j++) {
      if (excludedIndexes.has(j) || isEducationLike(lines[j])) continue;
      if (!selected.includes(lines[j])) selected.push(lines[j]);
    }
  }

  return selected;
}

function extractTargetJobs(targetLines) {
  if (!targetLines.length) return [];
  return findCanonicalMatches(linesToText(targetLines), POSITION_DICTIONARY, POSITION_ALIASES);
}

function titleCase(str) {
  return String(str).replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

/** Tebak posisi dari kombinasi skill (fallback terakhir, hanya untuk keyword pencarian). */
function inferRolesFromSkills(skills) {
  const skillSet = new Set((skills || []).map((s) => s.toLowerCase()));
  const scored = [];
  for (const { role, skills: roleSkills, min } of ROLE_FROM_SKILLS) {
    const hits = roleSkills.filter((s) => skillSet.has(s)).length;
    if (hits >= min) scored.push({ role, hits });
  }
  return scored.sort((a, b) => b.hits - a.hits).map((s) => s.role);
}

const MAX_KEYWORDS = 5; // tiap keyword = satu sesi browser scraping, jadi jangan terlalu banyak.

function generateSearchKeywords(targetJobs, experiencePositions, skills) {
  const keywords = new Map(); // lowercase -> tampilan
  const add = (value) => {
    const clean = String(value || "").trim();
    if (clean && !keywords.has(clean.toLowerCase())) keywords.set(clean.toLowerCase(), titleCase(clean));
  };

  for (const target of targetJobs || []) add(target);
  for (const position of experiencePositions || []) add(position);

  // Skill yang memang berupa "jenis pekerjaan" boleh jadi keyword sendiri.
  const jobLikeSkills = ["data entry", "customer service", "digital marketing", "accounting"];
  for (const skill of skills || []) {
    if (jobLikeSkills.includes(skill.toLowerCase())) add(skill);
  }

  if (keywords.size === 0) {
    for (const role of inferRolesFromSkills(skills)) add(role);
  }

  // Benar-benar tidak ada petunjuk: pakai skill teratas (bukan skill pertama di kamus).
  if (keywords.size === 0 && skills?.length) add(skills[0]);

  return Array.from(keywords.values()).slice(0, MAX_KEYWORDS);
}

const CONTACT_LINE = /@|\+?62[\s\d-]{7,}|\b08\d{7,}|linkedin|github\.com/i;

/**
 * Cari domisili. Urutan: label eksplisit -> header CV -> sekitar baris kontak (email/telepon)
 * -> mana saja di luar section pendidikan/pengalaman. Section pendidikan & pengalaman
 * dikecualikan karena nama kampus/perusahaan ("Institut Teknologi Nasional Bandung")
 * bukan domisili.
 */
function extractLocation(lines, excludedIndexes = new Set()) {
  const labelRegex = /^(?:domisili|lokasi|location|alamat|address|kota|city)\s*[:\-]\s*(.+)$/i;
  for (const line of lines) {
    const match = line.match(labelRegex);
    if (!match || match[1].trim().length < 3) continue;

    const labeledValue = match[1].trim();
    const knownCity = findMatches(labeledValue, LOCATION_DICTIONARY)
      .sort((a, b) => b.length - a.length)[0];
    return knownCity ? titleCase(knownCity) : labeledValue;
  }

  const longestCityIn = (text) => {
    const found = findMatches(text, LOCATION_DICTIONARY);
    return found.length ? titleCase([...found].sort((a, b) => b.length - a.length)[0]) : null;
  };

  const usable = (i) => !excludedIndexes.has(i) && !isEducationLike(lines[i]);

  // 1) Header: 35 baris pertama yang bukan bagian pendidikan/pengalaman.
  const head = lines.slice(0, 35).filter((_, i) => usable(i)).join("\n");
  const fromHead = longestCityIn(head);
  if (fromHead) return fromHead;

  // 2) Sekitar baris kontak (CV dua kolom sering menaruh kontak di akhir hasil ekstraksi PDF).
  for (let i = 0; i < lines.length; i++) {
    if (!CONTACT_LINE.test(lines[i])) continue;
    const near = [];
    for (let j = Math.max(0, i - 2); j <= Math.min(lines.length - 1, i + 2); j++) {
      if (usable(j)) near.push(lines[j]);
    }
    const city = longestCityIn(near.join("\n"));
    if (city) return city;
  }

  // 3) Bagian mana pun di luar pendidikan/pengalaman.
  const rest = lines.filter((_, i) => usable(i)).join("\n");
  const fromRest = longestCityIn(rest);
  if (fromRest) return fromRest;

  const province = findMatches(rest, PROVINCE_DICTIONARY)[0];
  return province ? titleCase(province) : null;
}

function monthsBetween(range) {
  return Math.max(0, range.end - range.start);
}

function mergeMonthRanges(ranges) {
  if (!ranges.length) return 0;
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  let total = 0;
  let cur = { ...sorted[0] };

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start <= cur.end) {
      cur.end = Math.max(cur.end, sorted[i].end);
    } else {
      total += monthsBetween(cur);
      cur = { ...sorted[i] };
    }
  }
  total += monthsBetween(cur);
  return Math.round((total / 12) * 10) / 10;
}

function monthIndexOf(token) {
  if (!token) return null;
  return MONTH_INDEX[token.toLowerCase().slice(0, 3)] ?? null;
}

function extractExperienceYears(text, experienceText = "", referenceDate = new Date()) {
  const lower = String(text || "").toLowerCase();

  // Hanya klaim eksplisit tentang PENGALAMAN ("3 tahun pengalaman", "5+ years of experience").
  // Jangan tangkap "24 tahun" (usia) atau "4 tahun" (lama kuliah).
  const explicitPatterns = [
    /(\d{1,2})\s*\+?\s*tahun\s*(?:pengalaman|experience)/g,
    /pengalaman(?:\s+kerja)?\s*(?:selama\s*)?(\d{1,2})\s*\+?\s*tahun/g,
    /(\d{1,2})\s*\+?\s*years?(?:\s*of)?\s*(?:work(?:ing)?\s*)?experience/g,
  ];

  let explicitMax = 0;
  for (const pattern of explicitPatterns) {
    let match;
    while ((match = pattern.exec(lower)) !== null) {
      const value = Number.parseInt(match[1], 10);
      if (Number.isFinite(value) && value > 0 && value <= 40) explicitMax = Math.max(explicitMax, value);
    }
  }
  if (explicitMax > 0) return explicitMax;

  const workText = String(experienceText || "");
  if (!workText.trim()) return 0;

  const nowIndex = referenceDate.getFullYear() * 12 + referenceDate.getMonth();
  const ranges = [];
  const rangePattern = new RegExp(DATE_RANGE_SOURCE, "gi");
  let match;
  while ((match = rangePattern.exec(workText)) !== null) {
    const [, startMonthToken, startYearToken, endMonthToken, endYearToken, ongoingToken] = match;
    const startYear = Number.parseInt(startYearToken, 10);
    const startMonth = monthIndexOf(startMonthToken);
    const start = startYear * 12 + (startMonth ?? 0);

    let end;
    if (ongoingToken) {
      end = nowIndex;
    } else {
      const endYear = Number.parseInt(endYearToken, 10);
      const endMonth = monthIndexOf(endMonthToken);
      // "2021 - 2023" (tanpa bulan) tetap dihitung selisih tahun; "Juni 2023 - Agustus 2023" = 2 bulan.
      end = endYear * 12 + (endMonth ?? (startMonth === null ? 0 : startMonth));
      if (endMonth === null && startMonth === null && endYear === startYear) end = start + 6; // satu tahun tanpa bulan ~ setengah tahun
    }

    if (end >= start && end - start <= 40 * 12) ranges.push({ start, end });
  }
  return mergeMonthRanges(ranges);
}

function guessSeniority(text, experienceYears) {
  const lower = String(text || "").toLowerCase();
  if (SENIORITY_KEYWORDS.senior.some((k) => wordBoundaryIncludes(lower, k))) return "Senior";
  if (SENIORITY_KEYWORDS.junior.some((k) => wordBoundaryIncludes(lower, k))) return "Junior/Entry Level";
  if (experienceYears >= 5) return "Senior";
  if (experienceYears >= 2) return "Mid Level";
  // 0 tahun pengalaman kerja terdeteksi = entry level (fresh graduate / belum ada riwayat kerja di CV).
  return "Junior/Entry Level";
}

function extractStructuredData(rawText, referenceDate = new Date()) {
  const normalizedText = String(rawText || "")
    .replace(/\r/g, "")
    .replace(/[\u00A0\t]+/g, " ");
  const lines = normalizedText.split("\n").map((line) => line.trim()).filter(Boolean);

  const experienceRange = findSectionRange(lines, SECTION_ALIASES.experience);
  const educationRange = findSectionRange(lines, SECTION_ALIASES.education);
  const skillsRange = findSectionRange(lines, SECTION_ALIASES.skills);
  const targetSection = findSection(lines, SECTION_ALIASES.target);
  const summarySection = findSection(lines, SECTION_ALIASES.summary);

  const experienceSection = experienceRange.lines;
  const educationSection = educationRange.lines;
  const skillsSection = skillsRange.lines;

  // Baris yang BUKAN pengalaman kerja: pendidikan dan blok skill.
  const nonWorkIndexes = new Set([...educationRange.indexes, ...skillsRange.indexes]);

  // PENTING: posisi pengalaman hanya dicari di work-experience section.
  // Kalau CV tidak punya heading section, fallback hanya memakai baris di sekitar rentang tanggal
  // (di luar pendidikan/skill).
  const experienceLines = experienceSection.length > 0
    ? experienceSection
    : inferExperienceText(lines, nonWorkIndexes);
  const experienceText = linesToText(experienceLines);

  const skillSearchText = skillsSection.length > 0
    ? `${linesToText(skillsSection)}\n${normalizedText}`
    : normalizedText;

  let skills = findCanonicalMatches(skillSearchText, SKILL_DICTIONARY, SKILL_ALIASES);
  const skillFrequency = buildSkillFrequency(normalizedText, skills);
  // Skill yang paling sering disebut di CV di depan; urutan kamus bukan sinyal apa pun.
  skills = skills
    .map((skill, idx) => ({ skill, idx }))
    .sort((a, b) => (skillFrequency[b.skill] - skillFrequency[a.skill]) || (a.idx - b.idx))
    .map((s) => s.skill);

  const experience = findCanonicalMatches(experienceText, POSITION_DICTIONARY, POSITION_ALIASES);
  const targetJobs = extractTargetJobs(targetSection);

  // Sebutan posisi di blok skill/ringkasan ("Backend Developer: Laravel, Python") = petunjuk arah karier.
  let roleHints = [];
  if (targetJobs.length === 0 && experience.length === 0) {
    const hintText = `${linesToText(skillsSection)}\n${linesToText(summarySection)}`;
    roleHints = findCanonicalMatches(hintText, POSITION_DICTIONARY, POSITION_ALIASES);
  }

  const fallbackTargetJobs = targetJobs.length > 0
    ? targetJobs
    : experience.length > 0 ? experience : roleHints;
  const keywords = generateSearchKeywords(fallbackTargetJobs, experience, skills);
  const location = extractLocation(lines, new Set([...educationRange.indexes, ...experienceRange.indexes]));
  const experienceYears = extractExperienceYears(normalizedText, experienceText, referenceDate);
  const seniorityText = `${linesToText(summarySection)}\n${experienceText}`;
  const seniority = guessSeniority(seniorityText, experienceYears);

  const targetSource = targetJobs.length > 0
    ? "target_section"
    : experience.length > 0 ? "experience"
      : roleHints.length > 0 ? "role_mentions" : "inferred_from_skills";

  return {
    name: guessName(lines),
    skills,
    experience,
    // Teks mentah section pengalaman, untuk ditampilkan kalau tidak ada nama posisi yang cocok kamus.
    experienceEntries: experienceSection.slice(0, 12),
    education: educationSection.slice(0, 10),
    keywords,
    experienceYears,
    skillFrequency,
    seniority,
    targetJobs: fallbackTargetJobs.length > 0 ? fallbackTargetJobs : keywords,
    location,
    parserMeta: {
      experienceSectionDetected: experienceSection.length > 0,
      educationSectionDetected: educationSection.length > 0,
      skillsSectionDetected: skillsSection.length > 0,
      targetSectionDetected: targetSection.length > 0,
      targetSource,
      locationDetected: Boolean(location),
    },
  };
}

async function parseCVFromBuffer(pdfBuffer) {
  if (!Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) {
    throw new Error("File CV kosong atau tidak valid.");
  }
  if (pdfBuffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("File yang diupload bukan PDF yang valid.");
  }

  const data = await pdfParse(pdfBuffer);
  const rawText = data.text || "";
  if (!rawText.trim()) {
    throw new Error("Tidak bisa membaca text dari PDF ini. Pastikan PDF bukan hasil scan gambar.");
  }

  const structured = extractStructuredData(rawText);
  return {
    ...structured,
    // Dipakai untuk debugging di UI (tampilan "Lihat teks mentah hasil baca PDF").
    rawTextPreview: rawText.slice(0, 2500),
  };
}

module.exports = {
  parseCVFromBuffer,
  extractStructuredData,
  findSection,
  extractExperienceYears,
};
