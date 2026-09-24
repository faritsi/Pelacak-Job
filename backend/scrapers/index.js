// scrapers/index.js
// Tugas file ini: titik masuk (entry point) untuk semua scraper.
// Saat ini hanya Glints yang aktif, tapi struktur ini modular:
// nanti tinggal tambah scraper baru (Jobstreet, LinkedIn, dst) dan daftarkan di sini
// tanpa mengubah route atau service lain.

const { searchGlintsJobs, fetchDescriptionsForJobs } = require("./glintsScraper");
const { jitteredDelay } = require("./scraperUtils");

const SCRAPE_DELAY_MS = parseInt(process.env.SCRAPE_DELAY_MS || "1500", 10);

// Daftar sumber yang aktif. Tambahkan entry baru di sini kalau ada scraper baru
// (butuh searchFn dan, kalau mendukung, enrichFn untuk deskripsi lengkap).
const ACTIVE_SOURCES = [
  { name: "Glints", searchFn: searchGlintsJobs, enrichFn: fetchDescriptionsForJobs },
];

/**
 * searchAllKeywords
 * Menjalankan pencarian untuk setiap keyword, di setiap sumber aktif.
 * @param {string[]} keywords
 * @param {object} [options]
 * @param {(event: object) => void} [options.onProgress] - dipanggil real-time tiap tahap
 *   (bukan simulasi timer di frontend) supaya progress bar benar-benar merefleksikan apa
 *   yang sedang backend kerjakan.
 * @returns {Promise<{ jobs: Array, errors: Array<string> }>}
 */
async function searchAllKeywords(keywords, options = {}) {
  const { onProgress, signal } = options;
  if (!Array.isArray(keywords)) throw new Error("Keyword pencarian tidak valid.");
  const allJobs = [];
  const errors = [];

  const totalTasks = ACTIVE_SOURCES.length * keywords.length;
  let completedTasks = 0;

  for (const source of ACTIVE_SOURCES) {
    for (const keyword of keywords) {
      onProgress?.({
        stage: "scraping",
        source: source.name,
        keyword,
        message: `Mencari "${keyword}" di ${source.name}...`,
        completedTasks,
        totalTasks,
      });

      try {
        if (signal?.aborted) throw new Error("Pencarian dibatalkan karena koneksi client terputus.");
        const jobs = await source.searchFn(keyword, {
          signal,
          onProgress: (pageEvent) =>
            onProgress?.({
              stage: "scraping",
              source: source.name,
              keyword,
              message: `${source.name} - "${keyword}": halaman ${pageEvent.page}, ${pageEvent.totalSoFar} lowongan terkumpul`,
              completedTasks,
              totalTasks,
            }),
        });
        // Tandai sumber & keyword yang menghasilkan job ini (berguna untuk debugging)
        const taggedJobs = jobs.map((j) => ({ ...j, source: source.name, matchedKeyword: keyword }));
        allJobs.push(...taggedJobs);
      } catch (error) {
        errors.push(error.message);
        onProgress?.({ stage: "scraping_error", source: source.name, keyword, message: error.message });
      }

      completedTasks++;
      if (signal?.aborted) throw new Error("Pencarian dibatalkan karena koneksi client terputus.");
      await jitteredDelay(SCRAPE_DELAY_MS); // jeda antar keyword, jangan agresif ke server sumber
    }
  }

  return { jobs: allJobs, errors };
}

/**
 * enrichJobDescriptions
 * Perkaya deskripsi lengkap untuk sejumlah job teratas (per sumber), supaya matching skill
 * tidak hanya bergantung pada judul lowongan. Job dari sumber yang tidak mendukung enrichFn
 * dilewati apa adanya (tetap dipakai, hanya saja deskripsinya seadanya dari listing).
 *
 * @param {Array} jobs - sebaiknya sudah diurutkan berdasarkan skor awal (kandidat terbaik dulu)
 * @param {object} [options]
 * @param {number} [options.limit] - jumlah maksimum job yang diperkaya PER SUMBER
 * @param {(event: object) => void} [options.onProgress]
 */
async function enrichJobDescriptions(jobs, options = {}) {
  const { limit, onProgress, signal } = options;

  for (const source of ACTIVE_SOURCES) {
    if (!source.enrichFn) continue;
    const jobsFromSource = jobs.filter((j) => j.source === source.name);
    if (jobsFromSource.length === 0) continue;

    if (signal?.aborted) throw new Error("Pencarian dibatalkan karena koneksi client terputus.");
    await source.enrichFn(jobsFromSource, {
      limit,
      signal,
      onProgress: (event) =>
        onProgress?.({
          stage: "enriching",
          source: source.name,
          message: `Mengambil deskripsi lengkap ${source.name} (${(event.index ?? 0) + 1}/${event.total ?? "?"})`,
          ...event,
        }),
    });
  }

  return jobs;
}

module.exports = { searchAllKeywords, enrichJobDescriptions, ACTIVE_SOURCES };
