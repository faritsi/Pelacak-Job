// routes/jobRoutes.js
// Endpoint: POST /api/search-jobs

const express = require("express");
const { searchAllKeywords, enrichJobDescriptions } = require("../scrapers/index");
const { dedupeJobs } = require("../utils/dedupe");
const { parsePostedDate, isWithinLastNDays } = require("../utils/dateParser");
const { parseSalary } = require("../utils/salaryParser");
const { checkSalaryAgainstUMR } = require("../services/umrService");
const { calculateMatchScore } = require("../services/matchingService");
const { createRateLimiter } = require("../middleware/rateLimit");

const router = express.Router();

const MAX_POSTING_AGE_DAYS = Math.min(30, Math.max(1, Number.parseInt(process.env.MAX_POSTING_AGE_DAYS || "5", 10)));
const TOP_N = 10;
const ENRICH_LIMIT = Math.min(40, Math.max(0, Number.parseInt(process.env.DESCRIPTION_ENRICH_LIMIT || "25", 10)));
const MAX_KEYWORDS = Math.min(10, Math.max(1, Number.parseInt(process.env.MAX_KEYWORDS || "5", 10)));
const MAX_CONCURRENT_SEARCHES = Math.max(1, Number.parseInt(process.env.MAX_CONCURRENT_SEARCHES || "1", 10));
let activeSearches = 0;

const searchRateLimit = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 8,
  message: "Terlalu banyak pencarian dari alamat ini. Coba lagi beberapa menit lagi.",
});

function cleanStringArray(value, maxItems = 50, maxLength = 80) {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .filter((item) => typeof item === "string")
      .map((item) => item.trim().replace(/\s+/g, " "))
      .filter((item) => item.length > 0 && item.length <= maxLength)
  )].slice(0, maxItems);
}

function sanitizeSearchPayload(body) {
  const keywords = cleanStringArray(body.keywords, MAX_KEYWORDS, 80);
  const skills = cleanStringArray(body.skills, 50, 60);
  const experience = cleanStringArray(body.experience, 30, 80);
  const targetJobs = cleanStringArray(body.targetJobs, 20, 80);

  let experienceYears = Number(body.experienceYears);
  if (!Number.isFinite(experienceYears)) experienceYears = 0;
  experienceYears = Math.min(40, Math.max(0, experienceYears));

  let location = null;
  if (typeof body.location === "string" && body.location.trim().length > 0) {
    location = body.location.trim().slice(0, 160);
  }

  return { keywords, skills, experience, targetJobs, experienceYears, location };
}

function makeEmitter(res, isClientDisconnected) {
  return function emit(event) {
    if (isClientDisconnected() || res.writableEnded) return false;
    try {
      res.write(`${JSON.stringify(event)}\n`);
      return true;
    } catch (_error) {
      return false;
    }
  };
}

router.post("/search-jobs", searchRateLimit, async (req, res) => {
  const payload = sanitizeSearchPayload(req.body || {});

  if (payload.keywords.length === 0) {
    return res.status(400).json({ error: "Keyword pencarian tidak boleh kosong." });
  }

  if (activeSearches >= MAX_CONCURRENT_SEARCHES) {
    return res.status(429).json({
      error: "Server sedang memproses pencarian lain. Coba lagi setelah pencarian yang aktif selesai.",
    });
  }

  activeSearches += 1;
  const abortController = new AbortController();
  let clientDisconnected = false;

  const markDisconnected = () => {
    if (res.writableEnded) return;
    clientDisconnected = true;
    abortController.abort();
  };

  req.on("aborted", markDisconnected);
  res.on("close", markDisconnected);

  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
  });

  const emit = makeEmitter(res, () => clientDisconnected);

  try {
    emit({ type: "progress", stage: "start", percent: 2, message: "Memulai pencarian..." });

    const { jobs: rawJobs, errors: scrapeErrors } = await searchAllKeywords(payload.keywords, {
      signal: abortController.signal,
      onProgress: (evt) => {
        if (evt.stage === "scraping") {
          const ratio = evt.totalTasks > 0 ? evt.completedTasks / evt.totalTasks : 0;
          const percent = Math.round(5 + ratio * 45);
          emit({ type: "progress", stage: "scraping", percent, message: evt.message });
        } else if (evt.stage === "scraping_error") {
          emit({ type: "progress", stage: "scraping_error", message: `Peringatan: ${evt.message}` });
        }
      },
    });

    if (abortController.signal.aborted) return;

    if (rawJobs.length === 0) {
      const warnings = scrapeErrors.length > 0
        ? ["Sebagian/seluruh sumber job gagal diakses. Periksa warning di bawah.", ...scrapeErrors]
        : ["Tidak ditemukan lowongan untuk keyword yang diberikan."];

      emit({
        type: "result",
        data: { totalFound: 0, totalPassed: 0, topJobs: [], warnings },
      });
      return res.end();
    }

    emit({ type: "progress", stage: "dedupe", percent: 52, message: "Menghapus lowongan duplikat..." });
    const uniqueJobs = dedupeJobs(rawJobs);

    const cvData = {
      skills: payload.skills,
      experience: payload.experience,
      keywords: payload.keywords,
      targetJobs: payload.targetJobs.length > 0 ? payload.targetJobs : payload.keywords,
      experienceYears: payload.experienceYears,
    };

    emit({ type: "progress", stage: "filtering", percent: 55, message: "Memfilter berdasarkan tanggal posting..." });
    const candidates = [];
    let unparsedPostedDates = 0;

    for (const job of uniqueJobs) {
      if (abortController.signal.aborted) return;
      if (!job.title || !job.url) continue;

      const postedDate = parsePostedDate(job.postedDateRaw);
      if (!postedDate) {
        unparsedPostedDates += 1;
        continue;
      }
      if (!isWithinLastNDays(postedDate, MAX_POSTING_AGE_DAYS)) continue;

      const { minSalary, maxSalary } = parseSalary(job.salary);
      const { umr, status: salaryStatus, umrSource } = await checkSalaryAgainstUMR(minSalary, job.location);

      candidates.push({
        company: job.company,
        position: job.title,
        location: job.location,
        salary: job.salary,
        salaryMin: minSalary,
        salaryMax: maxSalary,
        umr,
        umrSource,
        salaryStatus,
        postedDate,
        url: job.url,
        source: job.source || "Glints",
        description: job.description || null,
      });
    }

    if (unparsedPostedDates > 0) {
      emit({
        type: "progress",
        stage: "warning",
        message: `${unparsedPostedDates} lowongan dilewati karena tanggal posting tidak dapat dibaca.`,
      });
    }

    emit({ type: "progress", stage: "prematching", percent: 62, message: "Menghitung skor awal kecocokan..." });
    for (const job of candidates) {
      const { score, matchedSkills, breakdown } = calculateMatchScore(cvData, job, payload.location);
      job.matchScore = score;
      job.matchedSkills = matchedSkills;
      job.scoreBreakdown = breakdown;
    }
    candidates.sort((a, b) => b.matchScore - a.matchScore);

    emit({
      type: "progress",
      stage: "enriching",
      percent: 68,
      message: `Mengambil deskripsi lengkap untuk ${Math.min(ENRICH_LIMIT, candidates.length)} kandidat teratas...`,
    });

    await enrichJobDescriptions(candidates, {
      limit: ENRICH_LIMIT,
      signal: abortController.signal,
      onProgress: (evt) => {
        if (evt.total) {
          const ratio = Math.min(1, ((evt.index ?? 0) + 1) / evt.total);
          const percent = Math.round(68 + ratio * 22);
          emit({ type: "progress", stage: "enriching", percent, message: evt.message });
        }
      },
    });

    if (abortController.signal.aborted) return;

    emit({ type: "progress", stage: "final_matching", percent: 92, message: "Menghitung skor akhir..." });
    for (const job of candidates) {
      const { score, matchedSkills, breakdown } = calculateMatchScore(cvData, job, payload.location);
      job.matchScore = score;
      job.matchedSkills = matchedSkills;
      job.scoreBreakdown = breakdown;
    }
    candidates.sort((a, b) => b.matchScore - a.matchScore);

    const topJobs = candidates.slice(0, TOP_N);
    emit({ type: "progress", stage: "done", percent: 100, message: "Selesai." });
    emit({
      type: "result",
      data: {
        totalFound: uniqueJobs.length,
        totalPassed: candidates.length,
        topJobs,
        warnings: [
          ...(scrapeErrors.length > 0 ? scrapeErrors : []),
          ...(unparsedPostedDates > 0 ? [`${unparsedPostedDates} lowongan dilewati karena tanggal posting tidak dapat dibaca.`] : []),
        ],
      },
    });
    return res.end();
  } catch (error) {
    if (abortController.signal.aborted || clientDisconnected) return;
    console.error("Error search-jobs:", error.message);
    emit({ type: "error", error: "Terjadi kesalahan saat mencari lowongan. Silakan coba lagi." });
    return res.end();
  } finally {
    activeSearches = Math.max(0, activeSearches - 1);
  }
});

module.exports = router;
