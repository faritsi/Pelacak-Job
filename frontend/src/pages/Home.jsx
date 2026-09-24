import { useState } from "react";
import UploadArea from "../components/UploadArea.jsx";
import StatusProgress from "../components/StatusProgress.jsx";
import JobTable from "../components/JobTable.jsx";
import JobDetailModal from "../components/JobDetailModal.jsx";
import { analyzeCV, searchJobs } from "../services/api.js";

// Tahapan aplikasi. Disimpan sebagai satu state "step" supaya alur mudah dibaca.
const STEP = {
  UPLOAD: "upload",
  CV_RESULT: "cv_result",
  SEARCHING: "searching",
  RESULTS: "results",
};

export default function Home() {
  const [step, setStep] = useState(STEP.UPLOAD);
  const [file, setFile] = useState(null);
  const [cvData, setCvData] = useState(null);
  const [statusText, setStatusText] = useState("");
  const [progress, setProgress] = useState(0);
  const [searchResult, setSearchResult] = useState(null);
  const [selectedJob, setSelectedJob] = useState(null);
  const [error, setError] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  // Reset semua state kembali ke awal (tombol "NEW SEARCH")
  function handleNewSearch() {
    setStep(STEP.UPLOAD);
    setFile(null);
    setCvData(null);
    setSearchResult(null);
    setSelectedJob(null);
    setError("");
    setProgress(0);
  }

  async function handleAnalyzeCV() {
    if (!file || isAnalyzing || isSearching) return;
    setError("");
    setIsAnalyzing(true);
    setStatusText("Parsing CV...");
    setProgress(30);

    try {
      const result = await analyzeCV(file);
      setCvData(result);
      setStep(STEP.CV_RESULT);
    } catch (err) {
      setError(err.response?.data?.error || "Gagal menganalisis CV. Coba lagi.");
    } finally {
      setProgress(0);
      setIsAnalyzing(false);
    }
  }

  async function handleSearchJobs() {
    if (!cvData || isAnalyzing || isSearching) return;
    setIsSearching(true);
    setStep(STEP.SEARCHING);
    setError("");
    setStatusText("Memulai pencarian...");
    setProgress(2);

    // Progress di bawah ini SEKARANG berasal langsung dari event real-time yang dikirim
    // backend (lihat services/api.js + backend/routes/jobRoutes.js), bukan timer simulasi
    // yang berjalan sendiri. Jadi kalau backend masih di tahap scraping, progress bar juga
    // masih menunjukkan tahap scraping — tidak akan "lompat duluan" ke tahap yang belum terjadi.
    try {
      const result = await searchJobs(
        {
          keywords: cvData.keywords,
          skills: cvData.skills,
          experience: cvData.experience,
          targetJobs: cvData.targetJobs,
          experienceYears: cvData.experienceYears,
          location: cvData.location || null,
        },
        (event) => {
          if (event.message) setStatusText(event.message);
          if (typeof event.percent === "number") setProgress(event.percent);
        }
      );
      setSearchResult(result);
      setProgress(100);
      setStep(STEP.RESULTS);
    } catch (err) {
      setError(err.response?.data?.error || "Glints tidak dapat diakses saat ini. Silakan coba lagi.");
      setStep(STEP.CV_RESULT); // kembali ke hasil CV supaya user bisa coba lagi
    } finally {
      setIsSearching(false);
    }
  }

  return (
    <div className="container">
      <h1 className="app-title">JOB TRACKER BERBASIS CV</h1>

      {error && <div className="error-box">{error}</div>}

      {step === STEP.UPLOAD && (
        <div className="card">
          <UploadArea onFileSelected={setFile} disabled={false} />
          <button className="btn btn-primary" onClick={handleAnalyzeCV} disabled={!file || isAnalyzing}>
            {isAnalyzing ? "ANALYZING..." : "ANALYZE CV"}
          </button>
          {progress > 0 && <StatusProgress statusText={statusText} progress={progress} />}
        </div>
      )}

      {step === STEP.CV_RESULT && cvData && (
        <div className="card">
          <h2>CV Analysis</h2>
          <p><strong>Nama:</strong> {cvData.name}</p>
          <p><strong>Perkiraan lama pengalaman:</strong> {cvData.experienceYears ?? 0} tahun ({cvData.seniority || "Tidak diketahui"})</p>
          <p><strong>Domisili:</strong> {cvData.location || "Tidak terdeteksi"}</p>

          <p><strong>Pengalaman:</strong></p>
          <ul>
            {cvData.experience?.length > 0
              ? cvData.experience.map((e) => <li key={e}>{e}</li>)
              : cvData.experienceEntries?.length > 0
                ? cvData.experienceEntries.map((e, idx) => <li key={idx}>{e}</li>)
                : <li>Tidak terdeteksi</li>}
          </ul>

          <p><strong>Skill:</strong></p>
          <ul>
            {cvData.skills?.length > 0
              ? cvData.skills.map((s) => <li key={s}>{s}</li>)
              : <li>Tidak terdeteksi</li>}
          </ul>

          <p><strong>Pendidikan:</strong></p>
          <ul>{cvData.education?.length ? cvData.education.map((ed, idx) => <li key={idx}>{ed}</li>) : <li>Tidak terdeteksi</li>}</ul>

          <p><strong>Target Job:</strong></p>
          <ul>
            {cvData.targetJobs?.length > 0
              ? cvData.targetJobs.map((t) => <li key={t}>{t}</li>)
              : <li>Tidak terdeteksi</li>}
          </ul>
          {cvData.parserMeta?.targetSource && cvData.parserMeta.targetSource !== "target_section" && (
            <p className="meta-info">
              Target job tidak tertulis di CV, jadi ditebak dari{" "}
              {{
                experience: "posisi di bagian pengalaman",
                role_mentions: "sebutan posisi di bagian skill/ringkasan",
                inferred_from_skills: "kombinasi skill",
              }[cvData.parserMeta.targetSource] || "isi CV"}
              .
            </p>
          )}

          {cvData.rawTextPreview && (
            <details className="meta-info">
              <summary>Lihat teks mentah hasil baca PDF (untuk cek parser)</summary>
              <pre style={{ whiteSpace: "pre-wrap" }}>{cvData.rawTextPreview}</pre>
            </details>
          )}

          <button className="btn btn-primary" onClick={handleSearchJobs} disabled={isSearching}>
            {isSearching ? "SEARCHING..." : "ANALYZE & SEARCH JOB"}
          </button>
          <button className="btn btn-secondary" onClick={handleNewSearch}>
            NEW SEARCH
          </button>
        </div>
      )}

      {step === STEP.SEARCHING && (
        <div className="card">
          <StatusProgress statusText={statusText} progress={progress} />
        </div>
      )}

      {step === STEP.RESULTS && searchResult && (
        <div className="card">
          <h2>10 JOB TERBAIK UNTUK CV KAMU</h2>
          <p className="meta-info">
            Last scan: {new Date().toLocaleDateString("id-ID")} &nbsp;|&nbsp; Source: Glints
          </p>
          <p className="meta-info">
            Filters: Posted {"<="} 5 hari, CV Match &nbsp;|&nbsp;
            Total ditemukan: {searchResult.totalFound}, Diproses & diberi skor: {searchResult.totalPassed}
          </p>
          <p className="meta-info">
            Catatan: gaji di bawah UMR TIDAK dibuang dari hasil — hanya memengaruhi skor
            kecocokan (lihat badge Salary vs UMR di tiap baris/detail).
          </p>

          {searchResult.warnings?.length > 0 && (
            <div className="warning-box">
              {searchResult.warnings.map((w, idx) => <p key={idx}>{w}</p>)}
            </div>
          )}

          <JobTable jobs={searchResult.topJobs} onSelectJob={setSelectedJob} />

          <button className="btn btn-secondary" onClick={handleNewSearch}>
            NEW SEARCH
          </button>
        </div>
      )}

      <JobDetailModal job={selectedJob} onClose={() => setSelectedJob(null)} />
    </div>
  );
}
