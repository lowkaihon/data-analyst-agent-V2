-- ⚠️  WARNING: This script will DELETE ALL DATA in your database
-- Only run this script if you want to completely reset your database
-- This is intended for development/testing purposes

-- Drop all CSV data tables (ds_*) dynamically
-- These are the actual tables containing uploaded CSV data
-- Must be dropped first since they're not tracked by foreign keys
DO $$
DECLARE
  table_record RECORD;
  dropped_count INTEGER := 0;
BEGIN
  FOR table_record IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
    AND tablename LIKE 'ds_%'
  LOOP
    EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(table_record.tablename) || ' CASCADE';
    dropped_count := dropped_count + 1;
    RAISE NOTICE 'Dropped data table: %', table_record.tablename;
  END LOOP;
  RAISE NOTICE 'Total data tables dropped: %', dropped_count;
END $$;

-- Drop all metadata tables in the correct order (respecting foreign key constraints)
DROP TABLE IF EXISTS rate_limits CASCADE;
DROP TABLE IF EXISTS reports CASCADE;
DROP TABLE IF EXISTS runs CASCADE;
DROP TABLE IF EXISTS chat_turns CASCADE;
DROP TABLE IF EXISTS datasets CASCADE;

-- Drop all indexes (they will be recreated by the initialization script)
DROP INDEX IF EXISTS idx_runs_dataset_id;
DROP INDEX IF EXISTS idx_runs_turn_id;
DROP INDEX IF EXISTS idx_runs_type;
DROP INDEX IF EXISTS idx_runs_pinned;
DROP INDEX IF EXISTS idx_chat_turns_dataset_id;
DROP INDEX IF EXISTS idx_reports_dataset_id;
DROP INDEX IF EXISTS idx_datasets_user_id;
DROP INDEX IF EXISTS idx_chat_turns_user_id;
DROP INDEX IF EXISTS idx_runs_user_id;
DROP INDEX IF EXISTS idx_reports_user_id;
DROP INDEX IF EXISTS idx_rate_limits_user_endpoint;
DROP INDEX IF EXISTS idx_rate_limits_cleanup;
DROP INDEX IF EXISTS idx_rate_limits_user_id;

-- Drop functions (they will be recreated by the initialization script)
DROP FUNCTION IF EXISTS check_rate_limit(UUID, TEXT, TIMESTAMPTZ);

-- Note: After running this script, you MUST run:
-- scripts/initialize_database.sql
-- to recreate the tables with the updated schema
