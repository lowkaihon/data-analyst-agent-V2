/**
 * Vega-Lite specification validation for security and correctness
 * Prevents XSS attacks and ensures specs are well-formed
 */

import type { VisualizationSpec } from "vega-embed"
import { CHART_CONSTRAINTS } from "./vega-config"

interface ValidationResult {
  isValid: boolean
  error?: string
  sanitizedSpec?: VisualizationSpec
}

/**
 * Validates and sanitizes a Vega-Lite specification
 *
 * Security checks:
 * - Ensures spec is an object (not string/code)
 * - Validates schema version
 * - Checks for dangerous properties (scripts, event handlers)
 * - Validates data volume
 * - Sanitizes data fields
 *
 * @param spec - The Vega-Lite specification to validate
 * @returns Validation result with sanitized spec if valid
 */
export function validateVegaSpec(spec: any): ValidationResult {
  // Type check: must be an object
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    return {
      isValid: false,
      error: "Invalid spec: must be a valid object",
    }
  }

  // Schema validation: must have valid $schema
  const validSchemas = [
    "https://vega.github.io/schema/vega-lite/v5.json",
    "https://vega.github.io/schema/vega-lite/v4.json",
  ]

  if (!spec.$schema || !validSchemas.some(valid => spec.$schema?.includes(valid))) {
    return {
      isValid: false,
      error: "Invalid or missing $schema property",
    }
  }

  // Data validation: check data volume
  if (spec.data?.values && Array.isArray(spec.data.values)) {
    if (spec.data.values.length > CHART_CONSTRAINTS.MAX_DATA_POINTS) {
      return {
        isValid: false,
        error: `Data exceeds maximum allowed points (${CHART_CONSTRAINTS.MAX_DATA_POINTS})`,
      }
    }

    // Sanitize data: ensure values are plain objects/primitives
    const sanitizedData = spec.data.values.map((row: any) => {
      if (typeof row !== "object" || row === null) {
        return row
      }

      // Remove any function properties or prototype pollution attempts
      const sanitizedRow: Record<string, any> = {}
      for (const key in row) {
        if (key === "__proto__" || key === "constructor" || key === "prototype") {
          continue // Skip dangerous keys
        }

        const value = row[key]
        if (typeof value === "function") {
          continue // Skip functions
        }

        sanitizedRow[key] = value
      }
      return sanitizedRow
    })

    spec = { ...spec, data: { ...spec.data, values: sanitizedData } }
  }

  // Security check: no expressions or event handlers
  const specString = JSON.stringify(spec)
  const dangerousPatterns = [
    /"expr":/i,          // Vega expressions can execute code
    /"signal":/i,        // Signals can contain expressions
    /"on":\s*\[/i,       // Event handlers
    /<script/i,          // Script tags
    /javascript:/i,      // JavaScript URLs
    /onerror=/i,         // Event attributes
    /onclick=/i,
  ]

  for (const pattern of dangerousPatterns) {
    if (pattern.test(specString)) {
      return {
        isValid: false,
        error: "Spec contains potentially dangerous properties",
      }
    }
  }

  // Dimension validation: ensure reasonable sizes
  if (spec.width && typeof spec.width === "number") {
    if (spec.width < CHART_CONSTRAINTS.MIN_WIDTH || spec.width > CHART_CONSTRAINTS.MAX_WIDTH) {
      return {
        isValid: false,
        error: `Width must be between ${CHART_CONSTRAINTS.MIN_WIDTH} and ${CHART_CONSTRAINTS.MAX_WIDTH}`,
      }
    }
  }

  if (spec.height && typeof spec.height === "number") {
    if (spec.height < CHART_CONSTRAINTS.MIN_HEIGHT || spec.height > CHART_CONSTRAINTS.MAX_HEIGHT) {
      return {
        isValid: false,
        error: `Height must be between ${CHART_CONSTRAINTS.MIN_HEIGHT} and ${CHART_CONSTRAINTS.MAX_HEIGHT}`,
      }
    }
  }

  return {
    isValid: true,
    sanitizedSpec: spec as VisualizationSpec,
  }
}

/**
 * Checks if a chart spec has a valid description for accessibility
 * @param spec - The Vega-Lite specification
 * @returns True if spec has a description
 */
export function hasAccessibleDescription(spec: any): boolean {
  return Boolean(spec?.description && typeof spec.description === "string" && spec.description.length > 0)
}

/**
 * Adds a fallback description if none exists
 * @param spec - The Vega-Lite specification
 * @param fallback - Fallback description text
 * @returns Spec with description
 */
export function ensureDescription(spec: any, fallback: string): any {
  if (hasAccessibleDescription(spec)) {
    return spec
  }

  return {
    ...spec,
    description: fallback || spec.title || "Data visualization",
  }
}
