// routes/cvRoutes.js
// Endpoint: POST /api/analyze-cv

const express = require("express");
const multer = require("multer");
const { parseCVFromBuffer } = require("../services/cvParser");
const { createRateLimiter } = require("../middleware/rateLimit");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 4 * 1024 * 1024,
    files: 1,
    fields: 2,
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      return cb(new Error("File harus berformat PDF."));
    }
    cb(null, true);
  },
});

const analyzeRateLimit = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: "Terlalu banyak upload/analyze CV dari alamat ini. Coba lagi beberapa menit lagi.",
});

router.post("/analyze-cv", analyzeRateLimit, (req, res) => {
  upload.single("cv")(req, res, async (uploadError) => {
    if (uploadError) {
      return res.status(400).json({ error: uploadError.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: "File CV (PDF) belum diupload." });
    }

    try {
      const cvData = await parseCVFromBuffer(req.file.buffer);
      return res.json(cvData);
    } catch (error) {
      console.error("Error parsing CV:", error.message);
      return res.status(422).json({ error: `Gagal membaca CV: ${error.message}` });
    }
  });
});

module.exports = router;
