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

  // Wrap the entire query as a subquery to handle CTEs, complex queries, etc.
  // This is more robust than trying to parse and modify the query structure
  // PostgreSQL supports CTEs inside subqueries: SELECT ... FROM (WITH ... SELECT ...) as data
  const statsQuery = `
SELECT
  ${xField},
  MIN(${yField}) as min,
  PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY ${yField}) as q1,
  PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY ${yField}) as median,
  PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY ${yField}) as q3,
  MAX(${yField}) as max,
  COUNT(*) as count
FROM (${cleanSql}) as data
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
