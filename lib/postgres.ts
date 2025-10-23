import { Pool } from "@neondatabase/serverless"

let pool: Pool | null = null

export function getPostgresPool() {
  if (pool) return pool

  const connectionString = process.env.SUPABASE_POSTGRES_URL_NON_POOLING || process.env.SUPABASE_POSTGRES_URL

  if (!connectionString) {
    throw new Error("Postgres connection string not found")
  }

  pool = new Pool({ connectionString })
  return pool
}
