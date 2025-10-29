-- ⚠️  WARNING: This script will DELETE ALL DATA in your database
-- Only run this script if you want to completely reset your database
-- This is intended for development/testing purposes

-- Drop all tables in the correct order (respecting foreign key constraints)
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

-- Note: After running this script, you MUST run:
-- scripts/initialize_database.sql
-- to recreate the tables with the updated schema
