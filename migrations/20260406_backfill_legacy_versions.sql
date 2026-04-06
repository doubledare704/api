-- Backfill legacy git-hash versions with semver 1.0.0-beta.N
-- Query existing versions ordered by created_at and assign sequential beta versions
-- This migration should be run AFTER 20260406_add_semver_columns.sql
-- Requires SQLite 3.8.3+ for recursive CTEs and ROW_NUMBER()

-- Step 1: Create a temporary table with ordered legacy version IDs and their sequence numbers
CREATE TEMPORARY TABLE temp_legacy_order AS
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) as seq
  FROM benchmark_versions 
  WHERE semver IS NULL
)
SELECT id, seq, '1.0.0-beta.' || CAST(seq AS TEXT) as semver FROM numbered;

-- Step 2: Apply updates to benchmark_versions using the temp table
UPDATE benchmark_versions
SET 
  semver = (SELECT semver FROM temp_legacy_order WHERE temp_legacy_order.id = benchmark_versions.id),
  label = 'Legacy Version ' || (SELECT CAST(seq AS TEXT) FROM temp_legacy_order WHERE temp_legacy_order.id = benchmark_versions.id)
WHERE EXISTS (SELECT 1 FROM temp_legacy_order WHERE temp_legacy_order.id = benchmark_versions.id);

-- Step 3: Clean up
DROP TABLE temp_legacy_order;

-- Verification query (run separately to verify results):
-- SELECT id, semver, label, created_at FROM benchmark_versions ORDER BY created_at ASC;
