// utils/salaryParser.js
// Parse gaji Indonesia ke angka Rupiah. Mendukung format:
// 4.500.000 | 4,5 juta | 4.5 jt | Rp4.500.000 - Rp6.000.000 | 4 - 6 juta

function cleanSalaryText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/rp\.?\s*/g, "")
    .replace(/\bper\s*(bulan|month)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumericAmount(rawNumber, unit = "") {
  if (rawNumber === null || rawNumber === undefined) return null;
  let value = String(rawNumber).trim().replace(/\s/g, "");
  if (!value) return null;

  const normalizedUnit = String(unit || "").toLowerCase();
  const multiplier = ["jt", "juta", "m", "million", "juta/bulan", "jt/bulan"].includes(normalizedUnit)
    ? 1_000_000
    : 1;

  if (multiplier > 1) {
    // Untuk suffix juta, titik/koma di antara digit tunggal/dua digit adalah desimal:
    // 4.5 jt => 4.500.000, 4,5 jt => 4.500.000.
    // Kalau ada pemisah ribuan penuh, hilangkan pemisah lalu kalikan.
    const separatorCount = (value.match(/[.,]/g) || []).length;
    if (separatorCount > 1) {
      value = value.replace(/[.,]/g, "");
    } else if (/^[\d]+[.,][\d]{1,2}$/.test(value)) {
      value = value.replace(",", ".");
    } else {
      value = value.replace(/,/g, "");
    }

    const number = Number.parseFloat(value);
    if (!Number.isFinite(number) || number <= 0) return null;
    return Math.round(number * multiplier);
  }

  // Angka Rupiah penuh tanpa suffix. Gunakan tanda pemisah sebagai ribuan.
  const digitsOnly = value.replace(/[^\d]/g, "");
  if (digitsOnly.length < 4) return null;
  const number = Number.parseInt(digitsOnly, 10);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function parseSingleAmount(text, defaultUnit = "") {
  if (!text) return null;
  const cleaned = cleanSalaryText(text);

  // Ambil angka + optional unit (jt/juta/m/million). Contoh "4.5 jt".
  const match = cleaned.match(/(\d+(?:[.,]\d+){0,2})\s*(jt|juta|m|million)?/i);
  if (!match) return null;
  return parseNumericAmount(match[1], match[2] || defaultUnit);
}

function parseSalary(rawText) {
  if (!rawText || typeof rawText !== "string") {
    return { minSalary: null, maxSalary: null };
  }

  const text = cleanSalaryText(rawText);
  if (!text || /^(?:-|n\/a|na|negotiable|nego|competitive|confidential)$/.test(text)) {
    return { minSalary: null, maxSalary: null };
  }

  // Range. Parse dua sisi secara terpisah supaya "4.5 jt - 6 jt" tidak dianggap 45 jt.
  const rangeMatch = text.match(/^(.*?)\s*(?:-|–|—|to)\s*(.*?)$/i);
  if (rangeMatch) {
    const sharedUnit = (text.match(/(?:jt|juta|million|\bm\b)\s*$/i) || text.match(/(?:jt|juta|million|\bm\b)/i))?.[0] || "";
    const min = parseSingleAmount(rangeMatch[1], sharedUnit);
    const max = parseSingleAmount(rangeMatch[2], sharedUnit);
    if (min !== null && max !== null) {
      return {
        minSalary: Math.min(min, max),
        maxSalary: Math.max(min, max),
      };
    }
    if (min !== null) return { minSalary: min, maxSalary: min };
    if (max !== null) return { minSalary: max, maxSalary: max };
  }

  const single = parseSingleAmount(text);
  if (single !== null) {
    return { minSalary: single, maxSalary: single };
  }

  return { minSalary: null, maxSalary: null };
}

module.exports = { parseSalary, parseSingleAmount, parseNumericAmount };
