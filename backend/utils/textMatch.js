// utils/textMatch.js
// Tugas file ini: helper pencocokan teks yang dipakai bersama oleh cvParser (rule-based
// keyword parser) dan matchingService.
//
// KENAPA FILE INI ADA:
// Sebelumnya banyak tempat memakai `text.includes(kata)` polos. Ini berisiko:
// - False positive: kata pendek seperti "r", "go", "css" bisa "ketemu" di tengah kata lain
//   yang tidak berkaitan sama sekali (mis. "css" di dalam "proccess" pada teks hasil OCR
//   yang berantakan, atau nama perusahaan).
// - Tidak menghargai variasi spasi/tanda baca ("data-analyst" vs "data analyst").
// Helper di sini mencocokkan per KATA (word boundary), bukan potongan huruf mentah.

/**
 * Escape karakter spesial regex supaya frasa bisa dipakai aman di dalam RegExp.
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Buat regex untuk satu frasa/kata, dengan word-boundary di kedua sisi, dan toleran
 * terhadap variasi spasi/dash/underscore di antara kata (mis. "data analyst" akan juga
 * cocok dengan "data-analyst" atau "data_analyst").
 */
function buildPhraseRegex(phrase) {
  const escaped = escapeRegex(phrase.trim()).replace(/\s+/g, "[\\s\\-_/]+");
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i");
}

/**
 * wordBoundaryIncludes
 * Cek apakah `phrase` muncul di `text` sebagai unit kata yang utuh (bukan potongan kata lain).
 */
function wordBoundaryIncludes(text, phrase) {
  if (!text || !phrase) return false;
  try {
    return buildPhraseRegex(phrase).test(text);
  } catch (_e) {
    // fallback aman kalau ada karakter aneh yang lolos escape
    return text.toLowerCase().includes(phrase.toLowerCase());
  }
}

/**
 * countOccurrences
 * Hitung berapa kali `phrase` muncul di `text` sebagai kata utuh. Dipakai sebagai
 * indikator kasar "seberapa sering disebut" (proxy proficiency), bukan pengukuran mahir/tidak.
 */
function countOccurrences(text, phrase) {
  if (!text || !phrase) return 0;
  try {
    const re = new RegExp(buildPhraseRegex(phrase).source, "gi");
    const matches = text.match(re);
    return matches ? matches.length : 0;
  } catch (_e) {
    return 0;
  }
}

module.exports = { escapeRegex, buildPhraseRegex, wordBoundaryIncludes, countOccurrences };
