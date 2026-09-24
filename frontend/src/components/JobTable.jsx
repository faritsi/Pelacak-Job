// Menampilkan daftar Top 10 lowongan dalam bentuk tabel.
export default function JobTable({ jobs, onSelectJob }) {
  if (!jobs || jobs.length === 0) {
    return (
      <p className="empty-state">
        Tidak ditemukan lowongan yang diposting dalam 5 hari terakhir untuk keyword ini.
        <br />(Lowongan dengan gaji di bawah UMR tetap ditampilkan kalau ada — hanya skornya
        lebih rendah, tidak dibuang.)
      </p>
    );
  }

  return (
    <table className="job-table">
      <thead>
        <tr>
          <th>No</th>
          <th>Nama Perusahaan</th>
          <th>Posisi</th>
          <th>Daerah</th>
          <th>Gaji</th>
          <th>vs UMR</th>
          <th>Match</th>
          <th>Link</th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((job, index) => (
          <tr key={job.url} onClick={() => onSelectJob(job)} className="job-row">
            <td>{index + 1}</td>
            <td>{job.company}</td>
            <td>{job.position}</td>
            <td>{job.location}</td>
            <td>{job.salary || "-"}</td>
            <td>
              <span className={`salary-badge salary-badge--${(job.salaryStatus || "unknown").toLowerCase()}`}>
                {job.salaryStatus === "PASS" ? "≥ UMR" : job.salaryStatus === "REJECT" ? "< UMR" : "?"}
              </span>
            </td>
            <td>{job.matchScore}%</td>
            <td>
              <a
                href={job.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                Lihat
              </a>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
