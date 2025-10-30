/**
 * Validation Utilities
 *
 * Helper functions for field validation and fuzzy matching in chart generation.
 * Extracted from route.ts to improve maintainability and testability.
 */

/**
 * Calculate Levenshtein distance between two strings for fuzzy matching.
 * Used to suggest similar column names when exact matches aren't found.
 *
 * @param str1 - First string to compare
 * @param str2 - Second string to compare
 * @returns The minimum number of single-character edits (insertions, deletions, or substitutions)
 */
export function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length
  const n = str2.length
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0))

  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1]
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,     // deletion
          dp[i][j - 1] + 1,     // insertion
          dp[i - 1][j - 1] + 1  // substitution
        )
      }
    }
  }

  return dp[m][n]
}

/**
 * Validate chart fields against available columns and provide intelligent suggestions.
 * Uses fuzzy matching to suggest similar column names when exact matches aren't found.
 *
 * @param fields - The chart fields to validate (xField, yField, colorField)
 * @param availableColumns - List of available column names from the query results
 * @returns Validation result with errors and suggestions for invalid fields
 */
export function validateChartFields(
  fields: { xField: string; yField: string; colorField?: string },
  availableColumns: string[]
): { valid: boolean; errors: string[]; suggestions: Record<string, string> } {
  const errors: string[] = []
  const suggestions: Record<string, string> = {}

  const fieldsToCheck = [
    { name: 'xField', value: fields.xField },
    { name: 'yField', value: fields.yField },
    ...(fields.colorField ? [{ name: 'colorField', value: fields.colorField }] : [])
  ]

  for (const field of fieldsToCheck) {
    if (!availableColumns.includes(field.value)) {
      // Find closest match using Levenshtein distance
      let closestMatch = availableColumns[0]
      let minDistance = levenshteinDistance(field.value.toLowerCase(), closestMatch.toLowerCase())

      for (const col of availableColumns) {
        const distance = levenshteinDistance(field.value.toLowerCase(), col.toLowerCase())
        if (distance < minDistance) {
          minDistance = distance
          closestMatch = col
        }
      }

      errors.push(`Field '${field.value}' not found in query results`)

      // Only suggest if it's reasonably close (distance < 40% of field length)
      if (minDistance <= Math.ceil(field.value.length * 0.4)) {
        suggestions[field.name] = closestMatch
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    suggestions
  }
}
