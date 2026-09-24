// utils/dedupe.js
// Tugas file ini: menghapus lowongan duplikat yang muncul dari beberapa keyword pencarian.

/**
 * Buat "kunci unik" dari sebuah job. Prioritas: URL asli (paling akurat).
 * Kalau URL tidak ada, fallback ke kombinasi company + title + location.
 */
function makeJobKey(job) {
  if (job.url) {
    return job.url.split("?")[0].toLowerCase().trim(); // buang query string agar tidak dianggap beda
  }
  const combo = `${job.company}-${job.title}-${job.location}`;
  return combo.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * dedupeJobs
 * @param {Array} jobs - daftar job (boleh mengandung duplikat)
 * @returns {Array} daftar job tanpa duplikat
 */
function dedupeJobs(jobs) {
  const seen = new Set();
  const result = [];

  for (const job of jobs) {
    const key = makeJobKey(job);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(job);
    }
  }

  return result;
}

module.exports = { dedupeJobs };
