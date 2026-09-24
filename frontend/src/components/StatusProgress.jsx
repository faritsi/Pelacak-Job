// Komponen ini menampilkan status teks + progress bar sederhana
// selama proses analisis CV / pencarian job berjalan.
export default function StatusProgress({ statusText, progress }) {
  return (
    <div className="status-progress">
      <p className="status-text">{statusText}</p>
      <div className="progress-bar-track">
        <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
      </div>
      <p className="progress-percent">{progress}%</p>
    </div>
  );
}
