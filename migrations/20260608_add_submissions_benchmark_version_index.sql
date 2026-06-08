-- Support grouped/count lookups by benchmark version without scanning submissions for each visible version.
CREATE INDEX IF NOT EXISTS idx_submissions_benchmark_version ON submissions(benchmark_version);
