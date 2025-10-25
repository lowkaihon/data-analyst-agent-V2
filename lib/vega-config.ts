/**
 * Shared Vega-Lite configuration for consistent theming across all charts
 * Following best practices from Vega-Lite documentation
 */

export const VEGA_BASE_CONFIG = {
  // Axis styling
  axis: {
    labelFontSize: 11,
    titleFontSize: 13,
    labelFont: "system-ui, -apple-system, sans-serif",
    titleFont: "system-ui, -apple-system, sans-serif",
    gridOpacity: 0.5,
    domainWidth: 1,
  },

  // Legend styling
  legend: {
    labelFontSize: 11,
    titleFontSize: 12,
    labelFont: "system-ui, -apple-system, sans-serif",
    titleFont: "system-ui, -apple-system, sans-serif",
  },

  // Title styling
  title: {
    fontSize: 16,
    font: "system-ui, -apple-system, sans-serif",
    anchor: "start" as const,
    fontWeight: 600,
  },

  // View styling
  view: {
    strokeWidth: 0,
    continuousWidth: 550,
    continuousHeight: 350,
  },

  // Mark-specific configurations
  bar: {
    discreteBandSize: 40,
    cornerRadiusEnd: 4,
  },

  line: {
    strokeWidth: 2,
    point: true,
  },

  area: {
    line: true,
    opacity: 0.7,
  },

  circle: {
    size: 80,
    opacity: 0.7,
  },
}

/**
 * Embed options for Vega-Embed
 * Consistent across all chart instances
 */
export const VEGA_EMBED_OPTIONS = {
  actions: {
    export: true,   // Allow PNG/SVG export
    source: false,  // Hide JSON source
    compiled: false, // Hide Vega source
    editor: false,  // Hide editor link
  },
  renderer: "canvas" as const, // Use canvas for better performance
}

/**
 * Chart dimension constraints
 * Based on best practices for data volume and performance
 */
export const CHART_CONSTRAINTS = {
  MAX_DATA_POINTS: 10000, // Vega-Lite handles up to ~10k points smoothly
  MIN_WIDTH: 300,
  MAX_WIDTH: 1200,
  MIN_HEIGHT: 200,
  MAX_HEIGHT: 800,
  DEFAULT_WIDTH: 550,
  DEFAULT_HEIGHT: 350,
}
