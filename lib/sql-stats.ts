// SQL statistics aggregation for large dataset visualizations
// Generates PERCENTILE_CONT queries for boxplot visualization

/**
 * Convert a raw data SQL query into a statistical aggregation query
 * for boxplot visualization using PostgreSQL's PERCENTILE_CONT function
 *
 * @param sql - Original SQL query (SELECT x, y FROM table WHERE ...)
 * @param xField - Categorical field for grouping (x-axis)
 * @param yField - Quantitative field for distribution (y-axis)
 * @returns SQL query that returns {x, min, q1, median, q3, max} per category
 */
export function convertToStatsQuery(
  sql: string,
  xField: string,
  yField: string
): string {
  // Remove trailing semicolon and LIMIT clause
  let cleanSql = sql.trim()
  if (cleanSql.endsWith(';')) {
    cleanSql = cleanSql.slice(0, -1).trim()
  }

  // Remove LIMIT clause (case-insensitive)
  cleanSql = cleanSql.replace(/\s+LIMIT\s+\d+\s*$/i, '')

  // Extract the FROM clause and everything after it (WHERE, JOIN, etc.)
  // This regex captures FROM ... up to potential GROUP BY, ORDER BY, or end
  const fromMatch = cleanSql.match(/\bFROM\b(.*?)(?:\bGROUP\s+BY\b|\bORDER\s+BY\b|$)/is)

  if (!fromMatch) {
    throw new Error('Could not parse FROM clause from SQL query')
  }

  const fromClause = fromMatch[1].trim()

  // Extract WHERE clause if it exists
  const whereMatch = cleanSql.match(/\bWHERE\b(.*?)(?:\bGROUP\s+BY\b|\bORDER\s+BY\b|\bLIMIT\b|$)/is)
  const whereClause = whereMatch ? `WHERE ${whereMatch[1].trim()}` : ''

  // Build the statistical aggregation query
  // PERCENTILE_CONT requires WITHIN GROUP (ORDER BY ...)
  const statsQuery = `
SELECT
  ${xField},
  MIN(${yField}) as min,
  PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY ${yField}) as q1,
  PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY ${yField}) as median,
  PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY ${yField}) as q3,
  MAX(${yField}) as max,
  COUNT(*) as count
FROM ${fromClause}
${whereClause}
GROUP BY ${xField}
ORDER BY ${xField}
  `.trim()

  return statsQuery
}

/**
 * Check if a query is simple enough to convert to stats
 * Returns false if query contains complex features that would break conversion
 */
export function canConvertToStats(sql: string): boolean {
  const upperSql = sql.toUpperCase()

  // Don't convert if query already has aggregation
  if (upperSql.includes('GROUP BY')) {
    return false
  }

  // Don't convert if query has DISTINCT (changes semantics)
  if (upperSql.includes('DISTINCT')) {
    return false
  }

  // Don't convert if query uses window functions
  if (upperSql.includes('OVER (')) {
    return false
  }

  return true
}
