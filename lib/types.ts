// Shared types for the Data Analyst Agent

export interface Dataset {
  id: string
  file_name: string
  user_context: string | null
  table_name: string
  row_count: number
  column_count: number
  created_at: string
}

export interface ChatTurn {
  id: string
  dataset_id: string
  started_at: string
}

export type RunType = "sql" | "chart" | "validate" | "summarize"
export type RunStatus = "success" | "failed"

export interface Run {
  id: string
  dataset_id: string
  turn_id: string | null
  time_iso: string
  type: RunType
  status: RunStatus
  sql?: string | null
  rows?: number | null
  duration_ms?: number | null
  error?: string | null
  insight?: string | null
  chart_spec?: any | null
  sample?: any | null
  pinned: boolean
}

export interface Report {
  id: string
  dataset_id: string
  title: string | null
  markdown: string | null
  created_at: string
}

export interface ColumnStat {
  name: string
  type: string
  null_count: number
  null_percent: number
  unique_count: number
  min?: string | number | null
  max?: string | number | null
}

export interface QueryResult {
  columns: string[]
  rows: any[]
  rowCount: number
  durationMs: number
}
