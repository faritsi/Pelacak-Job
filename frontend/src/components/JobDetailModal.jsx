// Modal detail lowongan, muncul ketika user klik salah satu baris di tabel.
export default function JobDetailModal({ job, onClose }) {
  if (!job) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>
          ×
        </button>

        <h2>{job.position}</h2>
        <p className="modal-company">{job.company}</p>

        <div className="modal-grid">
          <div>
            <strong>Lokasi</strong>
            <p>{job.location}</p>
          </div>
          <div>
            <strong>Gaji</strong>
            <p>{job.salary || "-"}</p>
          </div>
          <div>
            <strong>UMR daerah</strong>
            <p>
              {job.umr ? `Rp${job.umr.toLocaleString("id-ID")}` : "Tidak diketahui"}
              {job.umrSource && job.umrSource !== "unknown" ? ` (sumber: ${job.umrSource})` : ""}
            </p>
          </div>
          <div>
            <strong>Salary vs UMR</strong>
            <p className={`salary-badge salary-badge--${(job.salaryStatus || "unknown").toLowerCase()}`}>
              {job.salaryStatus === "PASS" ? "Memenuhi UMR" : job.salaryStatus === "REJECT" ? "Di bawah UMR" : "Tidak diketahui"}
            </p>
          </div>
          <div>
            <strong>Posted</strong>
            <p>{job.postedDate}</p>
          </div>
          <div>
            <strong>CV Match</strong>
            <p>{job.matchScore}%</p>
          </div>
          <div>
            <strong>Source</strong>
            <p>{job.source}</p>
          </div>
        </div>

        {job.description && (
          <div className="modal-description">
            <strong>Deskripsi</strong>
            <p>{job.description.slice(0, 800)}{job.description.length > 800 ? "..." : ""}</p>
          </div>
        )}

        {job.scoreBreakdown && (
          <div className="modal-breakdown">
            <strong>Rincian skor</strong>
            <ul>
              <li>Skill: {job.scoreBreakdown.skillScore}%</li>
              <li>Pengalaman (posisi): {job.scoreBreakdown.experienceScore}%</li>
              <li>Posisi/keyword: {job.scoreBreakdown.positionScore}%</li>
              <li>Lokasi: {job.scoreBreakdown.locationScore}%</li>
              <li>Gaji vs UMR: {job.scoreBreakdown.salaryScore}%</li>
              <li>Lama pengalaman: {job.scoreBreakdown.experienceYearsScore}%</li>
            </ul>
          </div>
        )}

        {job.matchedSkills?.length > 0 && (
          <div className="modal-skills">
            <strong>Matched Skills</strong>
            <ul>
              {job.matchedSkills.map((skill) => (
                <li key={skill}>✓ {skill}</li>
              ))}
            </ul>
          </div>
        )}

        <a
          className="btn btn-primary"
          href={job.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          OPEN JOB
        </a>
      </div>
    </div>
  );
}
