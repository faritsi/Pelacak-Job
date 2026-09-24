// utils/dateParser.js
// Tugas file ini: mengubah berbagai format tanggal posting lowongan
// (misalnya "2 days ago", "Today", "21 Sep 2026") menjadi format standar "YYYY-MM-DD".

const BULAN_MAP = {
  jan: 0, feb: 1, mar: 2, apr: 3, mei: 4, may: 4, jun: 5, jul: 6,
  agu: 7, aug: 7, sep: 8, okt: 9, oct: 9, nov: 10, des: 11, dec: 11,
};

// Ubah objek Date menjadi string "YYYY-MM-DD"
function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * parsePostedDate
 * @param {string} rawText - teks tanggal mentah dari halaman Glints
 * @param {Date} referenceDate - tanggal "hari ini" (dibuat parameter supaya mudah di-test)
 * @returns {string|null} tanggal dalam format YYYY-MM-DD, atau null jika tidak bisa dibaca
 */
function parsePostedDate(rawText, referenceDate = new Date()) {
  if (!rawText || typeof rawText !== "string") return null;

  const text = rawText.trim().toLowerCase();

  // Kasus 1: "today" / "hari ini"
  if (text.includes("today") || text.includes("hari ini")) {
    return toISODate(referenceDate);
  }

  // Kasus 2: "yesterday" / "kemarin"
  if (text.includes("yesterday") || text.includes("kemarin")) {
    const d = new Date(referenceDate);
    d.setDate(d.getDate() - 1);
    return toISODate(d);
  }

  // Kasus 3: "N day(s) ago" atau "N hari yang lalu"
  const relativeMatch = text.match(/(\d+)\s*(day|days|hari)/);
  if (relativeMatch) {
    const daysAgo = parseInt(relativeMatch[1], 10);
    const d = new Date(referenceDate);
    d.setDate(d.getDate() - daysAgo);
    return toISODate(d);
  }

  // Kasus 4: jam/menit yang lalu -> dianggap hari ini
  if (/(hour|minute|jam|menit)/.test(text)) {
    return toISODate(referenceDate);
  }

  // Kasus 5: format "21 Sep 2026" atau "Sep 21, 2026"
  const monthNames = Object.keys(BULAN_MAP).join("|");
  const patternA = new RegExp(`(\\d{1,2})\\s+(${monthNames})[a-z]*\\s+(\\d{4})`, "i");
  const patternB = new RegExp(`(${monthNames})[a-z]*\\s+(\\d{1,2}),?\\s+(\\d{4})`, "i");

  let match = text.match(patternA);
  if (match) {
    const day = parseInt(match[1], 10);
    const month = BULAN_MAP[match[2].toLowerCase()];
    const year = parseInt(match[3], 10);
    return toISODate(new Date(year, month, day));
  }

  match = text.match(patternB);
  if (match) {
    const month = BULAN_MAP[match[1].toLowerCase()];
    const day = parseInt(match[2], 10);
    const year = parseInt(match[3], 10);
    return toISODate(new Date(year, month, day));
  }

  // Kasus 6: format "2026-09-21" (sudah ISO)
  const isoMatch = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return isoMatch[0];
  }

  // Tidak dikenali -> null (job ini nanti akan diperlakukan hati-hati / tidak lolos filter tanggal)
  return null;
}

/**
 * isWithinLastNDays
 * Cek apakah tanggal (format YYYY-MM-DD) berada dalam rentang N hari terakhir dari referenceDate.
 */
function isWithinLastNDays(isoDateString, days, referenceDate = new Date()) {
  if (!isoDateString) return false;

  const jobDate = new Date(isoDateString + "T00:00:00");
  const today = new Date(toISODate(referenceDate) + "T00:00:00");

  const diffMs = today.getTime() - jobDate.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  // Lowongan dari masa depan (data aneh) dianggap tidak valid
  if (diffDays < 0) return false;

  return diffDays <= days;
}

module.exports = { parsePostedDate, isWithinLastNDays, toISODate };
