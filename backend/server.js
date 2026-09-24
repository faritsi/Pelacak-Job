// server.js
// Entry point backend.

require("dotenv").config();
const express = require("express");
const cors = require("cors");

const cvRoutes = require("./routes/cvRoutes");
const jobRoutes = require("./routes/jobRoutes");

const app = express();
const PORT = Number(process.env.PORT || 5000);

const allowedOrigins = String(process.env.CORS_ORIGIN || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Origin tidak diizinkan oleh CORS."));
  },
}));

app.use(express.json({ limit: "256kb" }));

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "Job Tracker backend berjalan." });
});

// Endpoint diagnosis opsional. Ini membantu memastikan dependency serverless benar-benar
// terpasang dan binary Chromium bisa diekstrak di Vercel tanpa harus memulai pencarian job.
app.get("/api/browser-check", async (req, res) => {
  try {
    const chromiumModule = await import("@sparticuz/chromium");
    const sparticuz = chromiumModule.default || chromiumModule;
    await import("playwright-core");
    const executablePath = await sparticuz.executablePath();
    res.json({
      status: "ok",
      node: process.version,
      chromiumExecutableReady: Boolean(executablePath),
    });
  } catch (error) {
    console.error("Browser check error:", error);
    res.status(500).json({
      status: "error",
      code: error?.code || null,
      message: error?.message || String(error),
    });
  }
});

app.use("/api", cvRoutes);
app.use("/api", jobRoutes);

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Terjadi kesalahan pada server." });
});

app.listen(PORT, () => {
  console.log(`Job Tracker backend berjalan di http://localhost:${PORT}`);
});
