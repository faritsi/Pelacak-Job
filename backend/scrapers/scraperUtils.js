// scrapers/scraperUtils.js
// Tugas file ini: fungsi bantu yang dipakai bersama oleh semua scraper
// (delay antar request, launch browser Playwright, deteksi halaman blokir/captcha).

// Catatan: `playwright` / `playwright-core` + `@sparticuz/chromium` sengaja di-require di dalam
// launchBrowser() (lazy), supaya hanya modul yang dibutuhkan lingkungan saat ini yang di-load.

/**
 * Jeda beberapa milidetik. Dipakai supaya scraping tidak agresif / membebani website.
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * jitteredDelay
 * Sama seperti delay(), tapi durasinya diacak sedikit (+/- jitterRatio) supaya pola request
 * tidak terlalu "robotik" dan tidak membebani server secara serentak/berpola.
 */
function jitteredDelay(baseMs, jitterRatio = 0.35) {
  const min = baseMs * (1 - jitterRatio);
  const max = baseMs * (1 + jitterRatio);
  const ms = Math.round(min + Math.random() * (max - min));
  return delay(ms);
}

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
];

function pickUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// Vercel / AWS Lambda: tidak ada Chromium bawaan Playwright (npx playwright install tidak jalan di sana),
// dan tidak ada library sistem yang dibutuhkan. Di lingkungan ini kita pakai binary Chromium
// khusus serverless dari paket @sparticuz/chromium.
function isServerless() {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.AWS_EXECUTION_ENV);
}

/**
 * Buka browser Playwright dalam mode headless.
 * - Lokal / VPS / Docker: `playwright` biasa (butuh `npx playwright install chromium`,
 *   atau image Docker resmi Playwright — lihat backend/Dockerfile).
 * - Vercel / Lambda: `playwright-core` + `@sparticuz/chromium`.
 */
async function launchBrowser() {
  if (isServerless()) {
    let sparticuz;
    let playwrightCore;
    try {
      // @sparticuz/chromium sekarang ESM-only. Karena file backend ini masih CommonJS,
      // gunakan dynamic import() agar kompatibel dengan Node.js 24 di Vercel.
      const chromiumModule = await import("@sparticuz/chromium");
      sparticuz = chromiumModule.default || chromiumModule;
      playwrightCore = await import("playwright-core");
    } catch (error) {
      const detail = error?.code ? `${error.code}: ${error.message}` : error?.message || String(error);
      throw new Error(
        `Gagal memuat dependency Chromium serverless: ${detail}`
      );
    }
    const executablePath = await sparticuz.executablePath();
    return playwrightCore.chromium.launch({
      args: sparticuz.args,
      executablePath,
      headless: true,
    });
  }

  const { chromium } = require("playwright");
  return chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"], // aman untuk container Docker
  });
}

/**
 * Pesan error yang ramah untuk masalah launch browser, supaya UI tidak menampilkan
 * banner mentah Playwright ("Looks like Playwright was just installed...").
 */
function friendlyBrowserError(error) {
  const message = String(error?.message || error);
  if (/Executable doesn't exist|browserType\.launch/i.test(message)) {
    return "Browser (Chromium) tidak tersedia di server backend. Jalankan `npx playwright install chromium` di server, atau deploy backend dengan Docker/@sparticuz/chromium (lihat README bagian Deployment).";
  }
  return message;
}

/**
 * newStealthContext
 * Context browser dengan header/locale yang lebih "manusiawi" (bukan bypass anti-bot,
 * cuma menghindari fingerprint yang jelas-jelas mencolok sebagai bot default Playwright).
 */
async function newStealthContext(browser) {
  return browser.newContext({
    userAgent: pickUserAgent(),
    locale: "id-ID",
    timezoneId: "Asia/Jakarta",
    viewport: { width: 1366, height: 768 },
  });
}

/**
 * looksLikeBlocked
 * Deteksi kasar apakah halaman yang sedang dibuka kemungkinan halaman blokir/captcha/rate-limit,
 * supaya scraper bisa melempar pesan error yang jelas ("kemungkinan diblokir") alih-alih diam-diam
 * mengembalikan 0 hasil yang bikin bingung ("kenapa kosong, apa selector-nya salah atau memang
 * diblokir?").
 */
async function looksLikeBlocked(page) {
  try {
    const title = (await page.title())?.toLowerCase() || "";
    const bodyText = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
    const signals = [
      "captcha", "access denied", "are you a robot", "unusual traffic",
      "just a moment", "cloudflare", "403 forbidden", "blocked",
    ];
    return signals.some((s) => title.includes(s) || bodyText.includes(s));
  } catch (_e) {
    return false;
  }
}

module.exports = { delay, jitteredDelay, launchBrowser, friendlyBrowserError, isServerless, newStealthContext, looksLikeBlocked, pickUserAgent };
