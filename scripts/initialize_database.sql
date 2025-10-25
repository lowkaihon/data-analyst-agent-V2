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
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chat turns table: groups artifacts by conversation turn
CREATE TABLE IF NOT EXISTS chat_turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID REFERENCES datasets(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ DEFAULT NOW()
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
  pinned BOOLEAN DEFAULT FALSE
);

-- Reports table: stores generated markdown reports
CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID REFERENCES datasets(id) ON DELETE CASCADE,
  title TEXT,
  markdown TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_runs_dataset_id ON runs(dataset_id);
CREATE INDEX IF NOT EXISTS idx_runs_turn_id ON runs(turn_id);
CREATE INDEX IF NOT EXISTS idx_runs_type ON runs(type);
CREATE INDEX IF NOT EXISTS idx_runs_pinned ON runs(pinned);
CREATE INDEX IF NOT EXISTS idx_chat_turns_dataset_id ON chat_turns(dataset_id);
CREATE INDEX IF NOT EXISTS idx_reports_dataset_id ON reports(dataset_id);

-- Disable RLS on all tables (single-session app, no authentication)
ALTER TABLE datasets DISABLE ROW LEVEL SECURITY;
ALTER TABLE chat_turns DISABLE ROW LEVEL SECURITY;
ALTER TABLE runs DISABLE ROW LEVEL SECURITY;
ALTER TABLE reports DISABLE ROW LEVEL SECURITY;
