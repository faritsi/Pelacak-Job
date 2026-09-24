import { useRef, useState } from "react";

// Komponen upload CV (drag & drop sederhana + tombol pilih file)
export default function UploadArea({ onFileSelected, disabled }) {
  const inputRef = useRef(null);
  const [fileName, setFileName] = useState("");

  function handleFile(file) {
    if (!file) return;
    if (file.type !== "application/pdf") {
      alert("File harus berformat PDF.");
      return;
    }

    // Vercel Functions membatasi body request sekitar 4,5 MB. Sisakan ruang untuk
    // multipart overhead supaya upload CV tidak mentok 413 saat production.
    const maxSizeBytes = 4 * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      alert("Ukuran CV maksimal 4 MB untuk deployment Vercel.");
      return;
    }
    setFileName(file.name);
    onFileSelected(file);
  }

  function handleDrop(e) {
    e.preventDefault();
    if (disabled) return;
    const file = e.dataTransfer.files?.[0];
    handleFile(file);
  }

  return (
    <div
      className="upload-area"
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      <p className="upload-title">Upload CV kamu (PDF)</p>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        style={{ display: "none" }}
        onChange={(e) => handleFile(e.target.files?.[0])}
        disabled={disabled}
      />
      <button
        className="btn btn-secondary"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
      >
        Choose CV
      </button>
      {fileName && <p className="file-name">{fileName}</p>}
    </div>
  );
}
