-- Run this script first to set up the database schema
-- This creates all necessary tables for the Data Analyst Agent

-- Datasets table: stores metadata about uploaded CSV files
CREATE TABLE IF NOT EXISTS datasets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name TEXT NOT NULL,
  user_context TEXT,
  table_name TEXT NOT NULL,
  row_count INTEGER DEFAULT 0,
  column_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Chat turns table: groups artifacts by conversation turn
CREATE TABLE IF NOT EXISTS chat_turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID REFERENCES datasets(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Runs table: unified artifacts (SQL queries, charts, validations, summaries)
CREATE TABLE IF NOT EXISTS runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID REFERENCES datasets(id) ON DELETE CASCADE,
  turn_id UUID REFERENCES chat_turns(id) ON DELETE SET NULL,
  time_iso TIMESTAMPTZ DEFAULT NOW(),
  type TEXT NOT NULL CHECK (type IN ('sql', 'chart', 'validate', 'summarize', 'analysis_summary')),
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  sql TEXT,
  rows INTEGER,
  duration_ms INTEGER,
  error TEXT,
  insight TEXT,
  ai_response TEXT,
  chart_spec JSONB,
  sample JSONB,
  columns TEXT[],
  pinned BOOLEAN DEFAULT FALSE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Reports table: stores generated markdown reports
CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID REFERENCES datasets(id) ON DELETE CASCADE,
  title TEXT,
  markdown TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_runs_dataset_id ON runs(dataset_id);
CREATE INDEX IF NOT EXISTS idx_runs_turn_id ON runs(turn_id);
CREATE INDEX IF NOT EXISTS idx_runs_type ON runs(type);
CREATE INDEX IF NOT EXISTS idx_runs_pinned ON runs(pinned);
CREATE INDEX IF NOT EXISTS idx_chat_turns_dataset_id ON chat_turns(dataset_id);
CREATE INDEX IF NOT EXISTS idx_reports_dataset_id ON reports(dataset_id);

-- Create indexes for user_id columns (for RLS performance)
CREATE INDEX IF NOT EXISTS idx_datasets_user_id ON datasets(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_turns_user_id ON chat_turns(user_id);
CREATE INDEX IF NOT EXISTS idx_runs_user_id ON runs(user_id);
CREATE INDEX IF NOT EXISTS idx_reports_user_id ON reports(user_id);

-- Enable Row Level Security (RLS) on metadata tables
ALTER TABLE datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

-- RLS Policies for datasets table
-- Allow users to see their own datasets and orphaned datasets (user_id IS NULL)
DROP POLICY IF EXISTS "Users can view own datasets" ON datasets;
CREATE POLICY "Users can view own datasets" ON datasets
  FOR SELECT
  USING (auth.uid() = user_id OR user_id IS NULL);

DROP POLICY IF EXISTS "Users can insert own datasets" ON datasets;
CREATE POLICY "Users can insert own datasets" ON datasets
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own datasets" ON datasets;
CREATE POLICY "Users can update own datasets" ON datasets
  FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own datasets" ON datasets;
CREATE POLICY "Users can delete own datasets" ON datasets
  FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for chat_turns table
DROP POLICY IF EXISTS "Users can view own chat_turns" ON chat_turns;
CREATE POLICY "Users can view own chat_turns" ON chat_turns
  FOR SELECT
  USING (auth.uid() = user_id OR user_id IS NULL);

DROP POLICY IF EXISTS "Users can insert own chat_turns" ON chat_turns;
CREATE POLICY "Users can insert own chat_turns" ON chat_turns
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own chat_turns" ON chat_turns;
CREATE POLICY "Users can update own chat_turns" ON chat_turns
  FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own chat_turns" ON chat_turns;
CREATE POLICY "Users can delete own chat_turns" ON chat_turns
  FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for runs table
DROP POLICY IF EXISTS "Users can view own runs" ON runs;
CREATE POLICY "Users can view own runs" ON runs
  FOR SELECT
  USING (auth.uid() = user_id OR user_id IS NULL);

DROP POLICY IF EXISTS "Users can insert own runs" ON runs;
CREATE POLICY "Users can insert own runs" ON runs
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own runs" ON runs;
CREATE POLICY "Users can update own runs" ON runs
  FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own runs" ON runs;
CREATE POLICY "Users can delete own runs" ON runs
  FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for reports table
DROP POLICY IF EXISTS "Users can view own reports" ON reports;
CREATE POLICY "Users can view own reports" ON reports
  FOR SELECT
  USING (auth.uid() = user_id OR user_id IS NULL);

DROP POLICY IF EXISTS "Users can insert own reports" ON reports;
CREATE POLICY "Users can insert own reports" ON reports
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own reports" ON reports;
CREATE POLICY "Users can update own reports" ON reports
  FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own reports" ON reports;
CREATE POLICY "Users can delete own reports" ON reports
  FOR DELETE
  USING (auth.uid() = user_id);
