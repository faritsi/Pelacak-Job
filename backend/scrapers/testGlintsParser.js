// Test unit kecil untuk parser GraphQL Glints.
// Tidak membuka Chromium dan tidak membutuhkan koneksi internet.

const assert = require("node:assert/strict");
const {
  formatGraphQLSalary,
  normalizeGraphQLJob,
  parseGraphQLResponse,
} = require("./glintsScraper");

const sampleJob = {
  id: "abc-123",
  title: "Data Analyst",
  company: { name: "Contoh Tech" },
  city: { name: "Bandung" },
  country: { code: "ID", name: "Indonesia" },
  salaries: [
    {
      salaryType: "MONTHLY",
      salaryMode: "RANGE",
      minAmount: 5500000,
      maxAmount: 7500000,
      CurrencyCode: "IDR",
    },
  ],
  createdAt: "2026-09-23T08:00:00.000Z",
};

assert.equal(formatGraphQLSalary(sampleJob.salaries), "Rp 5.500.000 - Rp 7.500.000");

const normalized = normalizeGraphQLJob(sampleJob);
assert.equal(normalized.title, "Data Analyst");
assert.equal(normalized.company, "Contoh Tech");
assert.equal(normalized.location, "Bandung");
assert.equal(normalized.postedDateRaw, sampleJob.createdAt);
assert.match(normalized.url, /\/data-analyst\/abc-123$/);

const parsed = parseGraphQLResponse(
  JSON.stringify({ data: { searchJobsV3: { jobsInPage: [sampleJob], expInfo: null, hasMore: false } } }),
  200,
  "Data Analyst"
);
assert.equal(parsed.jobs.length, 1);
assert.equal(parsed.hasMore, false);

console.log("Glints GraphQL parser tests: OK");
