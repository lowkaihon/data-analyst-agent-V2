import { Pool } from "@neondatabase/serverless"

let pool: Pool | null = null

export function getPostgresPool() {
  if (pool) return pool

  const connectionString = process.env.SUPABASE_POSTGRES_URL_NON_POOLING || process.env.SUPABASE_POSTGRES_URL

  if (!connectionString) {
    throw new Error("Postgres connection string not found")
  }

  pool = new Pool({
    connectionString,
    max: 20, // Maximum pool size
    idleTimeoutMillis: 30000, // Close idle connections after 30s
    connectionTimeoutMillis: 10000, // Fail fast on connection issues
  })
  return pool
}
