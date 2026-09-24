// scrapers/glintsScraper.js
// Tugas file ini: mencari lowongan kerja di halaman PUBLIK Glints (tanpa login)
// berdasarkan satu keyword, lalu mengembalikan data mentah lowongan.
//
// PENTING:
// - Selector CSS di bawah ini dibuat modular (dikumpulkan di objek SELECTORS) karena
//   struktur halaman Glints bisa berubah sewaktu-waktu. Kalau scraping gagal/kosong,
//   kemungkinan besar selector perlu disesuaikan dengan struktur HTML Glints terbaru
//   (cek dengan DevTools browser).
// - Scraper ini TIDAK melakukan login, TIDAK bypass CAPTCHA/anti-bot.
// - Kalau scraping gagal total, fungsi ini melempar error yang jelas (bukan membuat data palsu).
//
// PERBAIKAN dari versi sebelumnya (supaya lebih tahan banting / "rawan" seperti disebut README):
// 1. Dulu selalu `page.waitForTimeout(2000)` tetap (jeda tetap, tebakan kasar). Sekarang pakai
//    `page.waitForSelector(...)` dengan timeout supaya scraper menunggu SAMPAI konten benar-benar
//    muncul (atau gagal dengan jelas), bukan menebak durasi tetap yang bisa kepotong di koneksi
//    lambat atau kebuang-buang waktu di koneksi cepat.
// 2. Dulu tidak ada deteksi halaman blokir/captcha sama sekali -> kalau Glints memblokir, hasilnya
//    diam-diam 0 job (user bingung apakah itu "tidak ada lowongan" atau "scraper rusak"). Sekarang
//    ada looksLikeBlocked() yang melempar error jelas begitu terdeteksi.
// 3. Dulu tidak ada retry -> satu kegagalan jaringan sementara langsung bikin seluruh keyword itu
//    gagal. Sekarang retry ringan (maks 2x) untuk kegagalan navigasi awal.
// 4. Sekarang MAX_PAGES_PER_KEYWORD dibatasi secara konservatif (default 8, hard cap 20)
//    supaya satu request tidak berubah menjadi ratusan navigasi browser. Pagination juga menunggu
//    marker job/URL benar-benar berubah agar tidak membaca halaman yang sama berulang kali.
// 5. Dulu scraper HANYA mengambil field dari kartu listing (title/company/location/salary/date),
//    TIDAK PERNAH mengambil deskripsi lowongan -> matchingService jadi cuma bisa mencocokkan CV
//    ke judul lowongan saja. Sekarang ada dua lapis: (a) cuplikan deskripsi dari kartu listing
//    kalau tersedia, dan (b) fetchDescriptionsForJobs() yang membuka halaman detail untuk
//    memperkaya deskripsi lengkap, TAPI hanya untuk sejumlah kandidat teratas (bukan semua job)
//    supaya tidak menambah beban ke server Glints secara berlebihan.

const { launchBrowser, newStealthContext, jitteredDelay, looksLikeBlocked, friendlyBrowserError } = require("./scraperUtils");

const GLINTS_SEARCH_URL = "https://glints.com/id/opportunities/jobs/explore";

// Default 8 halaman; nilai <= 0/invalid juga kembali ke default agar tidak ada mode "unlimited".
const RAW_MAX_PAGES = Number.parseInt(process.env.MAX_PAGES_PER_KEYWORD ?? "8", 10);
const MAX_PAGES_CONFIG = Number.isFinite(RAW_MAX_PAGES) && RAW_MAX_PAGES > 0 ? RAW_MAX_PAGES : 8;
const SAFETY_MAX_PAGES = 20; // batas keras anti-infinite-loop, bukan batas "normal"
const SCRAPE_DELAY_MS = parseInt(process.env.SCRAPE_DELAY_MS || "1500", 10);
const DESCRIPTION_ENRICH_LIMIT = parseInt(process.env.DESCRIPTION_ENRICH_LIMIT || "25", 10);
const NAV_TIMEOUT_MS = 30000;
const CONTENT_WAIT_TIMEOUT_MS = 12000;
const MAX_NAV_RETRIES = 2;

// Kumpulan selector dikumpulkan di sini supaya gampang di-update kalau Glints berubah struktur.
// Beberapa opsi disediakan sebagai fallback (dicoba satu-satu sampai ada yang cocok).
const SELECTORS = {
  jobCard: [
    "[class*='JobCard']",
    "[class*='job-card']",
    "a[href*='/opportunities/jobs/']",
  ],
  title: ["[class*='JobCardTitle']", "[class*='job-title']", "h2", "h3"],
  company: ["[class*='CompanyName']", "[class*='company-name']"],
  location: ["[class*='JobLocation']", "[class*='location']"],
  salary: ["[class*='Salary']", "[class*='salary']"],
  postedDate: ["[class*='PostedDate']", "[class*='posted']", "time"],
  // Cuplikan deskripsi/tags skill yang kadang ditampilkan langsung di kartu listing
  shortDescription: [
    "[class*='JobCardDescription']", "[class*='job-description']",
    "[class*='JobCardTags']", "[class*='SkillTag']", "[class*='tags']",
  ],
  nextPageButton: ["button[aria-label='Next']", "a[aria-label='Next']", "[class*='pagination'] button:last-child"],
  // Selector di halaman DETAIL lowongan (dipakai oleh fetchDescriptionsForJobs)
  detailDescription: [
    "[class*='JobDescription']", "[class*='job-description']",
    "[class*='JobDetail']", "article", "main",
  ],
};

/**
 * Coba beberapa selector satu per satu, kembalikan text dari selector pertama yang ketemu.
 */
async function tryGetText(cardHandle, selectorList) {
  for (const selector of selectorList) {
    try {
      const el = await cardHandle.$(selector);
      if (el) {
        const text = (await el.textContent())?.trim();
        if (text) return text;
      }
    } catch (_e) {
      // lanjut coba selector berikutnya
    }
  }
  return null;
}

async function tryGetHref(cardHandle) {
  try {
    const href = await cardHandle.getAttribute("href");
    if (href) return href.startsWith("http") ? href : `https://glints.com${href}`;

    const linkEl = await cardHandle.$("a");
    if (linkEl) {
      const linkHref = await linkEl.getAttribute("href");
      if (linkHref) return linkHref.startsWith("http") ? linkHref : `https://glints.com${linkHref}`;
    }
  } catch (_e) {
    // biarkan null
  }
  return null;
}

/**
 * Tunggu sampai minimal salah satu selector jobCard muncul di halaman, atau timeout.
 * Menggantikan `waitForTimeout` tetap yang lama supaya scraper tidak menebak-nebak durasi.
 */
async function waitForAnyJobCard(page, timeout = CONTENT_WAIT_TIMEOUT_MS) {
  try {
    await Promise.any(
      SELECTORS.jobCard.map((selector) =>
        page.waitForSelector(selector, { state: "visible", timeout })
      )
    );
    return true;
  } catch (_error) {
    return false;
  }
}

async function pageHasNoResultsMessage(page) {
  try {
    const bodyText = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
    return [
      "no jobs", "no results", "no result", "tidak ditemukan",
      "tidak ada lowongan", "belum ada lowongan", "0 lowongan",
    ].some((signal) => bodyText.includes(signal));
  } catch (_error) {
    return false;
  }
}

async function getFirstJobMarker(page) {
  for (const selector of SELECTORS.jobCard) {
    try {
      const card = await page.$(selector);
      if (!card) continue;
      const href = await tryGetHref(card);
      const title = await tryGetText(card, SELECTORS.title);
      if (href || title) return `${href || ""}|${title || ""}`;
    } catch (_error) {
      // selector fallback berikutnya
    }
  }
  return null;
}

async function waitForPageChange(page, beforeUrl, beforeMarker, signal) {
  const deadline = Date.now() + CONTENT_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("Pencarian dibatalkan karena koneksi client terputus.");

    if (page.url() !== beforeUrl) return true;
    const currentMarker = await getFirstJobMarker(page);
    if (currentMarker && beforeMarker && currentMarker !== beforeMarker) return true;

    if (await pageHasNoResultsMessage(page)) return false;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new Error("Pencarian dibatalkan karena koneksi client terputus.");
}

/**
 * Ambil daftar job dari satu halaman hasil pencarian yang sedang terbuka di `page`.
 */
async function extractJobsFromPage(page) {
  let cardHandles = [];

  // Coba tiap opsi selector job card sampai ada yang menghasilkan elemen
  for (const selector of SELECTORS.jobCard) {
    cardHandles = await page.$$(selector);
    if (cardHandles.length > 0) break;
  }

  const jobs = [];
  for (const card of cardHandles) {
    const title = await tryGetText(card, SELECTORS.title);
    const company = await tryGetText(card, SELECTORS.company);
    const location = await tryGetText(card, SELECTORS.location);
    const salary = await tryGetText(card, SELECTORS.salary);
    const postedDateRaw = await tryGetText(card, SELECTORS.postedDate);
    const shortDescription = await tryGetText(card, SELECTORS.shortDescription);
    const url = await tryGetHref(card);

    // Lewati kartu yang datanya terlalu kosong (kemungkinan bukan job card asli, misal iklan/banner)
    if (!title || !url) continue;

    jobs.push({
      title,
      company: company || "Tidak diketahui",
      location: location || "Tidak diketahui",
      salary: salary || null,
      postedDateRaw: postedDateRaw || null,
      description: shortDescription || null, // akan diperkaya lagi lewat fetchDescriptionsForJobs kalau perlu
      url,
    });
  }

  return jobs;
}

async function gotoWithRetry(page, url, signal) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_NAV_RETRIES; attempt++) {
    throwIfAborted(signal);
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
      throwIfAborted(signal);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_NAV_RETRIES) await jitteredDelay(1500);
    }
  }
  throw lastError;
}

/**
 * searchGlintsJobs
 * @param {string} keyword - kata kunci pencarian, misal "Data Analyst"
 * @param {object} [options]
 * @param {(event: object) => void} [options.onProgress] - callback progress per halaman
 * @returns {Promise<Array>} daftar job mentah (belum difilter/di-scoring)
 */
async function searchGlintsJobs(keyword, options = {}) {
  const { onProgress, signal } = options;
  let browser;
  const allJobs = [];

  const effectiveMaxPages = Math.min(MAX_PAGES_CONFIG, SAFETY_MAX_PAGES);

  try {
    browser = await launchBrowser();
    const context = await newStealthContext(browser);
    const page = await context.newPage();

    const searchUrl = `${GLINTS_SEARCH_URL}?keyword=${encodeURIComponent(keyword)}`;
    throwIfAborted(signal);
    await gotoWithRetry(page, searchUrl, signal);
    const initialCardsReady = await waitForAnyJobCard(page);

    if (await looksLikeBlocked(page)) {
      throw new Error(
        `Glints kemungkinan mendeteksi automasi/rate-limit untuk keyword "${keyword}" (halaman menunjukkan tanda captcha/blokir).`
      );
    }

    if (!initialCardsReady && !(await pageHasNoResultsMessage(page))) {
      throw new Error(
        `Selector job card tidak ditemukan untuk keyword "${keyword}". Kemungkinan struktur Glints berubah.`
      );
    }
    if (!initialCardsReady) return [];

    for (let pageIndex = 0; pageIndex < effectiveMaxPages; pageIndex++) {
      throwIfAborted(signal);
      const jobsOnThisPage = await extractJobsFromPage(page);
      allJobs.push(...jobsOnThisPage);
      onProgress?.({ keyword, page: pageIndex + 1, jobsOnPage: jobsOnThisPage.length, totalSoFar: allJobs.length });

      if (jobsOnThisPage.length === 0) break; // tidak ada job lagi / selector tidak cocok

      // Coba klik tombol "next page". Setelah klik, WAJIB menunggu marker job/URL berubah.
      // waitForSelector(jobCard) saja tidak cukup karena card lama masih ada di DOM.
      if (pageIndex < effectiveMaxPages - 1) {
        let clicked = false;
        const beforeUrl = page.url();
        const beforeMarker = await getFirstJobMarker(page);

        for (const selector of SELECTORS.nextPageButton) {
          const nextBtn = await page.$(selector);
          if (!nextBtn) continue;

          const disabled = await nextBtn.getAttribute("disabled");
          const ariaDisabled = await nextBtn.getAttribute("aria-disabled");
          const className = ((await nextBtn.getAttribute("class")) || "").toLowerCase();
          if (disabled !== null || ariaDisabled === "true" || className.includes("disabled")) continue;

          try {
            await nextBtn.click();
            clicked = true;
            break;
          } catch (_error) {
            // coba selector next berikutnya
          }
        }

        if (!clicked) break;

        const changed = await waitForPageChange(page, beforeUrl, beforeMarker, signal);
        if (!changed) break;

        if (await looksLikeBlocked(page)) {
          throw new Error(
            `Glints kemungkinan mendeteksi automasi/rate-limit saat pagination untuk keyword "${keyword}".`
          );
        }
      }

      await jitteredDelay(SCRAPE_DELAY_MS); // jeda antar halaman (dengan jitter), jangan agresif
    }

    await browser.close();
    return allJobs;
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    // Lempar ulang error dengan pesan jelas, JANGAN kembalikan data palsu
    throw new Error(`Gagal mengambil data dari Glints untuk keyword "${keyword}": ${friendlyBrowserError(error)}`);
  }
}

/**
 * fetchDescriptionsForJobs
 * Perkaya sejumlah job (dalam urutan yang diberikan — sebaiknya sudah diurutkan berdasarkan
 * skor kecocokan awal dari judul saja) dengan deskripsi LENGKAP dari halaman detail masing-masing.
 * Dibatasi jumlahnya (limit) supaya tidak membebani Glints dengan request ke semua job sekaligus.
 * Kegagalan per-job tidak menggagalkan job lain (skip saja, job tetap dipakai dengan deskripsi
 * seadanya dari listing).
 *
 * @param {Array} jobs - hanya job dengan source "Glints" yang diproses di sini
 * @param {object} [options]
 * @param {number} [options.limit]
 * @param {(event: object) => void} [options.onProgress]
 * @returns {Promise<Array>} array job yang sama, sebagian sudah punya field `description` terisi lebih lengkap
 */
async function fetchDescriptionsForJobs(jobs, options = {}) {
  const limit = Math.max(0, Math.min(Number(options.limit ?? DESCRIPTION_ENRICH_LIMIT), 40));
  const onProgress = options.onProgress;
  const signal = options.signal;

  const targets = jobs.slice(0, limit);
  if (targets.length === 0) return jobs;

  let browser;
  try {
    browser = await launchBrowser();
    const context = await newStealthContext(browser);
    const page = await context.newPage();

    for (let i = 0; i < targets.length; i++) {
      throwIfAborted(signal);
      const job = targets[i];
      try {
        await gotoWithRetry(page, job.url, signal);
        await Promise.any(
          SELECTORS.detailDescription.map((selector) =>
            page.waitForSelector(selector, { timeout: 6000 })
          )
        ).catch(() => {});

        if (await looksLikeBlocked(page)) {
          onProgress?.({ index: i, total: targets.length, status: "blocked", url: job.url });
          break; // berhenti duluan, sisanya tetap pakai deskripsi singkat dari listing (tidak fatal)
        }

        let fullText = null;
        for (const selector of SELECTORS.detailDescription) {
          const el = await page.$(selector);
          if (el) {
            const text = (await el.textContent())?.trim();
            if (text && text.length > (fullText?.length || 0)) fullText = text;
          }
        }

        if (fullText) {
          job.description = fullText.slice(0, 4000); // batasi panjang, cukup untuk matching
        }
        onProgress?.({ index: i, total: targets.length, status: "ok", url: job.url });
      } catch (error) {
        if (signal?.aborted) throw error;
        onProgress?.({ index: i, total: targets.length, status: "error", url: job.url, error: error.message });
        // lanjut ke job berikutnya, jangan gagalkan seluruh proses karena satu halaman detail
      }

      if (i < targets.length - 1) await jitteredDelay(SCRAPE_DELAY_MS);
    }

    await browser.close();
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    if (signal?.aborted) throw error;
    onProgress?.({ status: "fatal_error", error: error.message });
  }

  return jobs;
}

module.exports = { searchGlintsJobs, fetchDescriptionsForJobs };
