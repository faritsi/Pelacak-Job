// scrapers/scraperUtils.js
// Fungsi bantu yang dipakai bersama oleh scraper.
//
// Catatan penting:
// - Glints cukup sensitif terhadap browser serverless. Kita sengaja memakai
//   persistent browser context per request agar tidak terkena masalah
//   `Target page, context or browser has been closed` yang dapat terjadi pada
//   pola launch() -> newContext() di @sparticuz/chromium.
// - Tidak ada bypass CAPTCHA/anti-bot. Jika sumber memang memblokir request,
//   error diteruskan sebagai error yang jelas.

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

/** Jeda sederhana. */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Jeda dengan jitter kecil agar pola request tidak terlalu seragam. */
function jitteredDelay(baseMs, jitterRatio = 0.35) {
  const safeBase = Math.max(0, Number(baseMs) || 0);
  const min = safeBase * (1 - jitterRatio);
  const max = safeBase * (1 + jitterRatio);
  const ms = Math.round(min + Math.random() * (max - min));
  return delay(ms);
}

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
];

function pickUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function isServerless() {
  return Boolean(
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.AWS_EXECUTION_ENV
  );
}

function createUserDataDir() {
  return path.join(os.tmpdir(), `job-tracker-${randomUUID()}`);
}

function chromiumContextOptions(userAgent, extraArgs = []) {
  return {
    args: [
      ...extraArgs,
      "--no-sandbox",
      "--disable-dev-shm-usage",
      `--user-agent=${userAgent}`,
    ],
    headless: true,
    userAgent,
    locale: "id-ID",
    timezoneId: "Asia/Jakarta",
    viewport: { width: 1366, height: 768 },
    extraHTTPHeaders: {
      "accept-language": "id-ID,id;q=0.9,en;q=0.8",
    },
  };
}

/**
 * Buka Chromium dalam persistent context.
 * Return value sengaja berupa session `{ context, close }`, bukan Browser,
 * supaya caller tidak tergoda membuat `browser.newContext()` lagi.
 */
async function launchBrowser() {
  const userDataDir = createUserDataDir();
  const userAgent = pickUserAgent();
  let context;

  try {
    if (isServerless()) {
      let sparticuz;
      let playwrightCore;
      try {
        const chromiumModule = await import("@sparticuz/chromium");
        sparticuz = chromiumModule.default || chromiumModule;
        playwrightCore = await import("playwright-core");
      } catch (error) {
        const detail = error?.code
          ? `${error.code}: ${error.message}`
          : error?.message || String(error);
        throw new Error(`Gagal memuat dependency Chromium serverless: ${detail}`);
      }

      // Reduce graphics overhead on serverless. Method tersedia di versi
      // @sparticuz/chromium yang dipakai project ini; guard tetap dipasang
      // agar launcher tidak pecah bila API berubah.
      if (typeof sparticuz.setGraphicsMode === "function") {
        sparticuz.setGraphicsMode(false);
      }

      const executablePath = await sparticuz.executablePath();
      const serverlessOptions = chromiumContextOptions(userAgent);
      serverlessOptions.args = [
        ...(sparticuz.args || []),
        "--no-sandbox",
        "--disable-dev-shm-usage",
        `--user-agent=${userAgent}`,
      ];
      serverlessOptions.executablePath = executablePath;

      context = await playwrightCore.chromium.launchPersistentContext(
        userDataDir,
        serverlessOptions
      );
    } else {
      const { chromium } = require("playwright");
      context = await chromium.launchPersistentContext(
        userDataDir,
        chromiumContextOptions(userAgent)
      );
    }

    // Hindari resource tidak perlu di detail/search page.
    context.setDefaultTimeout(10000);
    context.setDefaultNavigationTimeout(30000);

    return {
      context,
      userDataDir,
      async close() {
        await context.close().catch(() => {});
        await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
      },
    };
  } catch (error) {
    if (context) await context.close().catch(() => {});
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

/** Pesan error yang lebih ramah untuk masalah browser/runtime. */
function friendlyBrowserError(error) {
  const message = String(error?.message || error);

  if (/Executable doesn't exist|browserType\.launch|chromium.*executable/i.test(message)) {
    return "Browser (Chromium) tidak tersedia di server backend. Jalankan `npx playwright install chromium` di server, atau gunakan deployment Docker/@sparticuz/chromium.";
  }

  if (/Target page, context or browser has been closed|Target closed/i.test(message)) {
    return "Chromium/Playwright menutup page atau browser sebelum request selesai. Gunakan launcher persistent context terbaru dan hindari membuat BrowserContext kedua di dalam request.";
  }

  return message;
}

/**
 * Deteksi kasar halaman CAPTCHA/rate-limit. Dipakai terutama saat membuka
 * halaman detail; pencarian utama sekarang menggunakan GraphQL.
 */
async function looksLikeBlocked(page) {
  try {
    const title = (await page.title())?.toLowerCase() || "";
    const bodyText = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
    const signals = [
      "captcha",
      "access denied",
      "are you a robot",
      "unusual traffic",
      "just a moment",
      "cloudflare",
      "403 forbidden",
      "blocked",
    ];
    return signals.some((s) => title.includes(s) || bodyText.includes(s));
  } catch (_error) {
    return false;
  }
}

module.exports = {
  delay,
  jitteredDelay,
  launchBrowser,
  friendlyBrowserError,
  isServerless,
  looksLikeBlocked,
  pickUserAgent,
};
