// src/services/api.js
// Tugas file ini: satu tempat untuk semua pemanggilan API ke backend.

import axios from "axios";

// Kalau VITE_API_BASE_URL diisi (misal saat deploy), pakai itu.
// Kalau kosong, pakai path relatif "/api" (dibantu proxy Vite saat development).
const BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

/**
 * Upload CV (PDF) ke backend untuk dianalisis.
 * @param {File} file
 */
export async function analyzeCV(file) {
  const formData = new FormData();
  formData.append("cv", file);

  const response = await axios.post(`${BASE_URL}/api/analyze-cv`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
}

/**
 * Cari lowongan berdasarkan hasil analisis CV.
 *
 * PERUBAHAN: sebelumnya ini satu request axios biasa yang menunggu balasan tunggal di akhir,
 * dan frontend "menebak" progress lewat timer terpisah yang tidak tahu-menahu tentang backend
 * (bisa jadi UI sudah bilang "Calculating match..." padahal backend masih scraping halaman 1).
 * Sekarang backend mengirim NDJSON (satu baris JSON per event) secara streaming, jadi kita baca
 * responsenya baris demi baris lewat fetch + ReadableStream, dan panggil onProgress(event) setiap
 * kali ada baris baru — progress yang ditampilkan jadi benar-benar mencerminkan tahap backend saat itu.
 *
 * @param {{ keywords: string[], skills: string[], experience: string[], experienceYears?: number, location?: string }} payload
 * @param {(event: { type: string, stage?: string, percent?: number, message?: string }) => void} [onProgress]
 * @returns {Promise<object>} data hasil pencarian (topJobs, totalFound, dst) dari event bertipe "result"
 */
export async function searchJobs(payload, onProgress) {
  const response = await fetch(`${BASE_URL}/api/search-jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok || !response.body) {
    // Fallback: kalau server tidak streaming (mis. error sebelum headers dikirim),
    // coba baca sebagai JSON biasa supaya pesan error tetap tersampaikan.
    let errorMessage = "Glints tidak dapat diakses saat ini. Silakan coba lagi.";
    try {
      const data = await response.json();
      errorMessage = data.error || errorMessage;
    } catch (_e) {
      // biarkan pesan default
    }
    const err = new Error(errorMessage);
    err.response = { data: { error: errorMessage } };
    throw err;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult = null;
  let streamError = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop(); // sisa baris yang belum lengkap, simpan untuk chunk berikutnya

    for (const line of lines) {
      if (!line.trim()) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch (_e) {
        continue; // baris rusak/tidak lengkap, lewati
      }

      if (event.type === "progress") {
        onProgress?.(event);
      } else if (event.type === "result") {
        finalResult = event.data;
      } else if (event.type === "error") {
        streamError = event.error;
      }
    }
  }

  // Server biasanya mengakhiri NDJSON dengan newline, tetapi parser tetap harus memproses
  // satu baris terakhir kalau koneksi ditutup tanpa trailing newline.
  if (buffer.trim()) {
    try {
      const event = JSON.parse(buffer.trim());
      if (event.type === "progress") onProgress?.(event);
      else if (event.type === "result") finalResult = event.data;
      else if (event.type === "error") streamError = event.error;
    } catch (_e) {
      // abaikan buffer yang memang bukan JSON lengkap
    }
  }

  if (streamError) {
    const err = new Error(streamError);
    err.response = { data: { error: streamError } };
    throw err;
  }

  if (!finalResult) {
    const err = new Error("Koneksi terputus sebelum hasil pencarian selesai. Coba lagi.");
    err.response = { data: { error: err.message } };
    throw err;
  }

  return finalResult;
}
