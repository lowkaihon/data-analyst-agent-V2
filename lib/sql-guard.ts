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

// Forbidden patterns using regex for more precise detection
const FORBIDDEN_PATTERNS = [
  /\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE|EXEC|EXECUTE)\b/i,
  /--/, // SQL line comments
  /\/\*/, // SQL multi-line comments start
  /;\s*(SELECT|WITH|INSERT|UPDATE|DELETE|DROP)/i, // Stacked queries
  /UNION\s+SELECT/i, // UNION-based injection
  /INTO\s+(OUTFILE|DUMPFILE)/i, // File operations
  /LOAD_FILE/i, // File reading
  /xp_cmdshell/i, // SQL Server command execution
  /pg_sleep/i, // Time-based attacks
]

export function validateReadOnlySQL(sql: string): { valid: boolean; error?: string } {
  const trimmedSQL = sql.trim()
  const upperSQL = trimmedSQL.toUpperCase()

  // Check for forbidden patterns using regex
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(trimmedSQL)) {
      return {
        valid: false,
        error: `Forbidden SQL pattern detected. Only SELECT queries are allowed.`,
      }
    }
  }

  // Check for forbidden keywords (kept for backward compatibility)
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
  // Strip trailing semicolon if present
  let cleanSql = sql.trim()
  const hasSemicolon = cleanSql.endsWith(';')
  if (hasSemicolon) {
    cleanSql = cleanSql.slice(0, -1).trim()
  }

  const upperSQL = cleanSql.toUpperCase()

  // If already has LIMIT, respect it but cap at maxLimit
  if (upperSQL.includes("LIMIT")) {
    const limitMatch = cleanSql.match(/LIMIT\s+(\d+)/i)
    if (limitMatch) {
      const requestedLimit = Number.parseInt(limitMatch[1], 10)
      if (requestedLimit > maxLimit) {
        cleanSql = cleanSql.replace(/LIMIT\s+\d+/i, `LIMIT ${maxLimit}`)
      }
    }
    return hasSemicolon ? `${cleanSql};` : cleanSql
  }

  // Add LIMIT if not present
  const result = `${cleanSql} LIMIT ${maxLimit}`
  return hasSemicolon ? `${result};` : result
}

export function sanitizeTableName(datasetId: string): string {
  // Create safe table name: ds_<uuid without hyphens>
  return `ds_${datasetId.replace(/-/g, "_")}`
}

export function assessQueryComplexity(sql: string): { allowed: boolean; reason?: string } {
  const upperSQL = sql.toUpperCase()

  // Count JOINs
  const joinCount = (upperSQL.match(/\bJOIN\b/g) || []).length
  if (joinCount > 3) {
    return { allowed: false, reason: "Too many JOINs (max 3)" }
  }

  // Check for nested subqueries
  const selectCount = (upperSQL.match(/\bSELECT\b/g) || []).length
  if (selectCount > 3) {
    return { allowed: false, reason: "Too many nested subqueries (max 2 nested)" }
  }

  return { allowed: true }
}

export function guardSQL(sql: string, tableName: string, maxLimit = 500): string {
  // Validate SQL is read-only
  const validation = validateReadOnlySQL(sql)
  if (!validation.valid) {
    throw new Error(validation.error)
  }

  // Check query complexity
  const complexity = assessQueryComplexity(sql)
  if (!complexity.allowed) {
    throw new Error(complexity.reason)
  }

  // Ensure LIMIT is applied
  const safeSql = ensureLimit(sql, maxLimit)

  return safeSql
}
