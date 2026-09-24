// scrapers/testScraper.js
// Script kecil untuk mengetes scraper Glints secara manual dari terminal, tanpa lewat frontend.
// Cara pakai: npm run test-scraper (dijalankan dari folder backend)

require("dotenv").config();
const { searchGlintsJobs } = require("./glintsScraper");

async function main() {
  const keyword = process.argv[2] || "Data Analyst";
  console.log(`Mencoba mencari lowongan untuk keyword: "${keyword}" ...`);

  try {
    const jobs = await searchGlintsJobs(keyword);
    console.log(`Berhasil! Ditemukan ${jobs.length} lowongan (mentah, sebelum filter).`);
    console.log(JSON.stringify(jobs.slice(0, 5), null, 2));
  } catch (error) {
    console.error("Scraping gagal:", error.message);
    console.error(
      "Kemungkinan penyebab: endpoint GraphQL Glints/WAF berubah, browser Chromium tidak tersedia, " +
        "atau koneksi internet/akses ke glints.com bermasalah."
    );
  }
}

main();
