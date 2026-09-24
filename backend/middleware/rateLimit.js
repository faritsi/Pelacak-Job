// middleware/rateLimit.js
// Rate limiter sederhana in-memory untuk endpoint publik.
// Cocok untuk single-instance deployment; untuk multi-instance gunakan Redis/external store.

function createRateLimiter({ windowMs = 10 * 60 * 1000, max = 10, message = "Terlalu banyak request. Coba lagi beberapa menit lagi." } = {}) {
  const buckets = new Map();

  return function rateLimiter(req, res, next) {
    const now = Date.now();
    const key = req.ip || req.socket?.remoteAddress || "unknown";

    if (buckets.size > 1000) {
      for (const [bucketKey, bucket] of buckets) {
        if (now - bucket.startedAt >= windowMs) buckets.delete(bucketKey);
      }
    }

    const current = buckets.get(key);

    if (!current || now - current.startedAt >= windowMs) {
      buckets.set(key, { startedAt: now, count: 1 });
      return next();
    }

    current.count += 1;
    if (current.count > max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (now - current.startedAt)) / 1000));
      res.set("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({ error: message, retryAfterSeconds });
    }

    return next();
  };
}

module.exports = { createRateLimiter };
