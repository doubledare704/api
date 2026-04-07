-- Add semver and label columns to benchmark_versions table
-- These may already exist if added manually via D1 Studio
ALTER TABLE benchmark_versions ADD COLUMN semver TEXT;
ALTER TABLE benchmark_versions ADD COLUMN label TEXT;

-- Backfill: If id looks like a semver (X.Y.Z), use it for both columns
-- Otherwise default to 0.0.1
UPDATE benchmark_versions
SET semver = CASE 
    WHEN id GLOB '[0-9]*.[0-9]*' OR id GLOB '[0-9]*.[0-9]*.[0-9]*' THEN id
    ELSE '0.0.1'
  END,
  label = CASE 
    WHEN id GLOB '[0-9]*.[0-9]*' OR id GLOB '[0-9]*.[0-9]*.[0-9]*' THEN id
    ELSE '0.0.1'
  END
WHERE semver IS NULL OR label IS NULL;
