// SQL safety utilities: enforce SELECT-only queries with auto-LIMIT

const ALLOWED_KEYWORDS = [
  "SELECT",
  "FROM",
  "WHERE",
  "JOIN",
  "LEFT",
  "RIGHT",
  "INNER",
  "OUTER",
  "ON",
  "AND",
  "OR",
  "NOT",
  "IN",
  "LIKE",
  "BETWEEN",
  "IS",
  "NULL",
  "AS",
  "GROUP",
  "BY",
  "HAVING",
  "ORDER",
  "LIMIT",
  "OFFSET",
  "DISTINCT",
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "WITH",
  "CTE",
]

const FORBIDDEN_KEYWORDS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "CREATE",
  "ALTER",
  "TRUNCATE",
  "GRANT",
  "REVOKE",
  "EXEC",
  "EXECUTE",
]

export function validateReadOnlySQL(sql: string): { valid: boolean; error?: string } {
  const upperSQL = sql.toUpperCase().trim()

  // Check for forbidden keywords
  for (const keyword of FORBIDDEN_KEYWORDS) {
    if (upperSQL.includes(keyword)) {
      return {
        valid: false,
        error: `Forbidden keyword detected: ${keyword}. Only SELECT queries are allowed.`,
      }
    }
  }

  // Must start with SELECT or WITH (for CTEs)
  if (!upperSQL.startsWith("SELECT") && !upperSQL.startsWith("WITH")) {
    return {
      valid: false,
      error: "Query must start with SELECT or WITH (for CTEs).",
    }
  }

  return { valid: true }
}

export function ensureLimit(sql: string, maxLimit = 500): string {
  const upperSQL = sql.toUpperCase()

  // If already has LIMIT, respect it but cap at maxLimit
  if (upperSQL.includes("LIMIT")) {
    const limitMatch = sql.match(/LIMIT\s+(\d+)/i)
    if (limitMatch) {
      const requestedLimit = Number.parseInt(limitMatch[1], 10)
      if (requestedLimit > maxLimit) {
        return sql.replace(/LIMIT\s+\d+/i, `LIMIT ${maxLimit}`)
      }
    }
    return sql
  }

  // Add LIMIT if not present
  return `${sql.trim()} LIMIT ${maxLimit}`
}

export function sanitizeTableName(datasetId: string): string {
  // Create safe table name: ds_<uuid without hyphens>
  return `ds_${datasetId.replace(/-/g, "_")}`
}

export function guardSQL(sql: string, tableName: string, maxLimit = 500): string {
  // Validate SQL is read-only
  const validation = validateReadOnlySQL(sql)
  if (!validation.valid) {
    throw new Error(validation.error)
  }

  // Ensure LIMIT is applied
  const safeSql = ensureLimit(sql, maxLimit)

  return safeSql
}
