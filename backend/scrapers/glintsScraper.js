// scrapers/glintsScraper.js
//
// Pencarian Glints tidak lagi bergantung pada selector DOM halaman explore lama.
// Glints saat ini menyediakan endpoint GraphQL internal yang dipakai halaman search.
// Request GraphQL dikirim DARI browser Playwright supaya request tetap memiliki konteks
// browser asli dan tidak berubah menjadi plain HTTP client yang mudah ditolak WAF.
//
// Fallback untuk deskripsi detail tetap menggunakan halaman job publik Glints.

const {
  launchBrowser,
  jitteredDelay,
  looksLikeBlocked,
  friendlyBrowserError,
} = require("./scraperUtils");

const GLINTS_GRAPHQL_URL =
  process.env.GLINTS_GRAPHQL_URL || "https://glints.com/api/v2-alc/graphql";
const GLINTS_DETAIL_BASE_URL = "https://glints.com/id/opportunities/jobs";
const GLINTS_REFERER =
  process.env.GLINTS_REFERER || "https://glints.com/id/opportunities/jobs/explore";

const DEFAULT_GRAPHQL_QUERY = `query searchJobsV3($data: JobSearchConditionInput!) {
  searchJobsV3(data: $data) {
    jobsInPage {
      id
      title
      company { name brandName }
      city { name }
      country { code name }
      salaries {
        salaryType
        salaryMode
        maxAmount
        minAmount
        CurrencyCode
      }
      createdAt
    }
    expInfo
    hasMore
  }
}`;

const RAW_MAX_PAGES = Number.parseInt(
  process.env.MAX_PAGES_PER_KEYWORD ?? "1",
  10
);
const MAX_PAGES_CONFIG =
  Number.isFinite(RAW_MAX_PAGES) && RAW_MAX_PAGES > 0 ? RAW_MAX_PAGES : 1;
const SAFETY_MAX_PAGES = 20;
const RAW_PAGE_SIZE = Number.parseInt(
  process.env.GLINTS_PAGE_SIZE ?? "30",
  10
);
const GLINTS_PAGE_SIZE = Math.min(
  30,
  Number.isFinite(RAW_PAGE_SIZE) && RAW_PAGE_SIZE > 0 ? RAW_PAGE_SIZE : 30
);
const SCRAPE_DELAY_MS = Number.parseInt(
  process.env.SCRAPE_DELAY_MS || "500",
  10
);
const DESCRIPTION_ENRICH_LIMIT = Number.parseInt(
  process.env.DESCRIPTION_ENRICH_LIMIT || "3",
  10
);
const API_BOOTSTRAP_TIMEOUT_MS = 10000;
const GRAPHQL_TIMEOUT_MS = 15000;
const DETAIL_NAV_TIMEOUT_MS = 20000;
const MAX_BROWSER_RETRIES = 2;
const MAX_DETAIL_LENGTH = 4000;

const DETAIL_SELECTORS = [
  "[class*='JobDescription']",
  "[class*='job-description']",
  "[class*='JobDetail']",
  "article",
  "main",
];

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new Error("Pencarian dibatalkan karena koneksi client terputus.");
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slugifyTitle(value) {
  return String(value || "job")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "job";
}

function buildJobUrl(job) {
  const id = String(job?.id || "").trim();
  if (!id) return null;
  return `${GLINTS_DETAIL_BASE_URL}/${slugifyTitle(job.title)}/${encodeURIComponent(id)}`;
}

function normalizeAmount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function formatMoney(amount, currency) {
  if (amount == null) return null;
  const rounded = Math.round(amount);
  const code = String(currency || "IDR").toUpperCase();
  if (code === "IDR") return `Rp ${rounded.toLocaleString("id-ID")}`;
  return `${code} ${rounded.toLocaleString("en-US")}`;
}

function formatGraphQLSalary(salaries) {
  if (!Array.isArray(salaries) || salaries.length === 0) return null;

  const valid = salaries
    .map((salary) => ({
      min: normalizeAmount(salary?.minAmount),
      max: normalizeAmount(salary?.maxAmount),
      currency: salary?.CurrencyCode || salary?.currencyCode || "IDR",
    }))
    .filter((salary) => salary.min != null || salary.max != null);

  if (valid.length === 0) return null;

  const minValues = valid.map((salary) => salary.min).filter((value) => value != null);
  const maxValues = valid.map((salary) => salary.max).filter((value) => value != null);
  const min = minValues.length ? Math.min(...minValues) : null;
  const max = maxValues.length ? Math.max(...maxValues) : null;
  const currency = valid[0].currency || "IDR";

  if (min != null && max != null) {
    if (min === max) return formatMoney(min, currency);
    return `${formatMoney(min, currency)} - ${formatMoney(max, currency)}`;
  }

  return formatMoney(min ?? max, currency);
}

function normalizeGraphQLJob(job) {
  const title = String(job?.title || "").trim();
  const url = buildJobUrl(job);
  if (!title || !url) return null;

  const company =
    String(job?.company?.name || job?.company?.brandName || "Tidak diketahui").trim() ||
    "Tidak diketahui";
  const location =
    String(job?.city?.name || job?.country?.name || "Tidak diketahui").trim() ||
    "Tidak diketahui";

  return {
    title,
    company,
    location,
    salary: formatGraphQLSalary(job?.salaries),
    postedDateRaw: job?.createdAt ? String(job.createdAt) : null,
    description: null,
    url,
  };
}

function parseGraphQLResponse(rawText, status, keyword) {
  let payload;
  try {
    payload = JSON.parse(rawText);
  } catch (_error) {
    throw new Error(
      `Respons pencarian Glints bukan JSON (HTTP ${status}) untuk keyword "${keyword}".`
    );
  }

  if (status < 200 || status >= 300) {
    const message = payload?.errors?.[0]?.message || `HTTP ${status}`;
    throw new Error(
      `Glints GraphQL menolak request untuk keyword "${keyword}": ${message}`
    );
  }

  if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
    const message = payload.errors.map((error) => error?.message).filter(Boolean).join("; ");
    throw new Error(
      `Glints GraphQL mengembalikan error untuk keyword "${keyword}": ${message || "Unknown GraphQL error"}`
    );
  }

  const result = payload?.data?.searchJobsV3;
  if (!result || !Array.isArray(result.jobsInPage)) {
    throw new Error(
      `Format respons GraphQL Glints berubah untuk keyword "${keyword}" (field searchJobsV3.jobsInPage tidak ada).`
    );
  }

  const jobs = result.jobsInPage.map(normalizeGraphQLJob).filter(Boolean);
  return {
    jobs,
    hasMore: Boolean(result.hasMore),
    expInfo: result.expInfo ?? null,
  };
}

async function bootstrapGraphQLPage(page, signal) {
  throwIfAborted(signal);
  await page
    .goto(GLINTS_GRAPHQL_URL, {
      waitUntil: "commit",
      timeout: API_BOOTSTRAP_TIMEOUT_MS,
    })
    .catch(() => {
      // Endpoint POST-only / 405 juga cukup untuk membuat origin page yang same-origin.
      // Yang penting context browser hidup dan fetch berikutnya dijalankan dari page.
    });
  throwIfAborted(signal);
}

async function fetchGraphQLPage(page, keyword, pageNumber, signal) {
  throwIfAborted(signal);

  const variables = {
    data: {
      SearchTerm: keyword,
      CountryCode: "ID",
      includeExternalJobs: true,
      pageSize: GLINTS_PAGE_SIZE,
      page: pageNumber,
    },
  };

  const result = await page.evaluate(
    async ({ endpoint, referer, query, variables, timeoutMs }) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          credentials: "include",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
          referrer: referer,
          referrerPolicy: "strict-origin-when-cross-origin",
          body: JSON.stringify({
            operationName: "searchJobsV3",
            query,
            variables,
          }),
          signal: controller.signal,
        });
        return {
          status: response.status,
          text: await response.text(),
        };
      } finally {
        clearTimeout(timeout);
      }
    },
    {
      endpoint: GLINTS_GRAPHQL_URL,
      referer: GLINTS_REFERER,
      query: DEFAULT_GRAPHQL_QUERY,
      variables,
      timeoutMs: GRAPHQL_TIMEOUT_MS,
    }
  );

  throwIfAborted(signal);
  return parseGraphQLResponse(result.text, result.status, keyword);
}

function isRetryableBrowserError(error) {
  const message = String(error?.message || error);
  return /Target page, context or browser has been closed|Target closed|browser has been closed|ECONNRESET|ERR_CONNECTION_RESET|Navigation timeout/i.test(
    message
  );
}

/**
 * Satu sesi pencarian lengkap. Bila Chromium mati di tengah jalan, caller dapat
 * mengulang sesi baru tanpa merusak daftar hasil dari sesi sebelumnya.
 */
async function searchWithBrowserSession(keyword, options = {}) {
  const { onProgress, signal } = options;
  const allJobs = [];
  const effectiveMaxPages = Math.min(MAX_PAGES_CONFIG, SAFETY_MAX_PAGES);

  const session = await launchBrowser();
  try {
    const page = await session.context.newPage();
    await bootstrapGraphQLPage(page, signal);

    for (let pageNumber = 1; pageNumber <= effectiveMaxPages; pageNumber++) {
      throwIfAborted(signal);
      const { jobs, hasMore } = await fetchGraphQLPage(
        page,
        keyword,
        pageNumber,
        signal
      );

      allJobs.push(...jobs);
      onProgress?.({
        keyword,
        page: pageNumber,
        jobsOnPage: jobs.length,
        totalSoFar: allJobs.length,
      });

      if (!hasMore || jobs.length === 0) break;
      if (pageNumber < effectiveMaxPages) {
        await jitteredDelay(SCRAPE_DELAY_MS);
      }
    }

    return allJobs;
  } finally {
    await session.close();
  }
}

/**
 * Cari lowongan Glints untuk satu keyword.
 *
 * Retry hanya dilakukan pada kegagalan browser/runtime yang sifatnya transient.
 * Error GraphQL/WAF tetap dilempar ke route supaya user melihat sumber masalah.
 */
async function searchGlintsJobs(keyword, options = {}) {
  const { signal } = options;
  let lastError;

  for (let attempt = 1; attempt <= MAX_BROWSER_RETRIES; attempt++) {
    throwIfAborted(signal);
    try {
      return await searchWithBrowserSession(keyword, options);
    } catch (error) {
      lastError = error;
      if (signal?.aborted || !isRetryableBrowserError(error) || attempt >= MAX_BROWSER_RETRIES) {
        break;
      }
      await sleep(600 * attempt);
    }
  }

  throw new Error(
    `Gagal mengambil data dari Glints untuk keyword "${keyword}": ${friendlyBrowserError(lastError)}`
  );
}

async function extractFullDescription(page) {
  let fullText = null;

  for (const selector of DETAIL_SELECTORS) {
    const elements = await page.$$(selector).catch(() => []);
    for (const element of elements) {
      const text = (await element.textContent().catch(() => ""))?.trim();
      if (text && text.length > (fullText?.length || 0)) {
        fullText = text;
      }
    }
  }

  // Fallback generik bila class selector berubah total.
  if (!fullText || fullText.length < 120) {
    const mainText = await page.locator("main").innerText().catch(() => "");
    if (mainText && mainText.trim().length > (fullText?.length || 0)) {
      fullText = mainText.trim();
    }
  }

  return fullText ? fullText.slice(0, MAX_DETAIL_LENGTH) : null;
}

/**
 * Perkaya kandidat teratas dengan deskripsi lengkap dari halaman detail publik.
 * Kegagalan satu detail tidak menggagalkan hasil pencarian utama.
 */
async function fetchDescriptionsForJobs(jobs, options = {}) {
  const limit = Math.max(
    0,
    Math.min(
      Number(options.limit ?? DESCRIPTION_ENRICH_LIMIT),
      40
    )
  );
  const onProgress = options.onProgress;
  const signal = options.signal;
  const targets = jobs.slice(0, limit);

  if (targets.length === 0) return jobs;

  let session;
  try {
    session = await launchBrowser();
    const page = await session.context.newPage();

    for (let i = 0; i < targets.length; i++) {
      throwIfAborted(signal);
      const job = targets[i];

      try {
        await page.goto(job.url, {
          waitUntil: "domcontentloaded",
          timeout: DETAIL_NAV_TIMEOUT_MS,
        });

        await Promise.any(
          DETAIL_SELECTORS.map((selector) =>
            page.waitForSelector(selector, { timeout: 5000 })
          )
        ).catch(() => {});

        if (await looksLikeBlocked(page)) {
          onProgress?.({
            index: i,
            total: targets.length,
            status: "blocked",
            url: job.url,
          });
          break;
        }

        const fullText = await extractFullDescription(page);
        if (fullText) job.description = fullText;

        onProgress?.({
          index: i,
          total: targets.length,
          status: "ok",
          url: job.url,
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        onProgress?.({
          index: i,
          total: targets.length,
          status: "error",
          url: job.url,
          error: friendlyBrowserError(error),
        });
      }

      if (i < targets.length - 1) {
        await jitteredDelay(SCRAPE_DELAY_MS);
      }
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    onProgress?.({
      status: "fatal_error",
      error: friendlyBrowserError(error),
    });
  } finally {
    if (session) await session.close().catch(() => {});
  }

  return jobs;
}

module.exports = {
  searchGlintsJobs,
  fetchDescriptionsForJobs,
  // Export kecil untuk test unit tanpa perlu membuka Chromium.
  formatGraphQLSalary,
  normalizeGraphQLJob,
  parseGraphQLResponse,
};
