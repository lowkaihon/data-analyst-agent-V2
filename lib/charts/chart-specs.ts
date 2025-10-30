/**
 * Chart Specifications Generator
 *
 * Generates Vega-Lite chart specifications for different chart types.
 * Extracted from route.ts to improve maintainability and testability.
 */

interface ChartParams {
  chartType: "bar" | "line" | "scatter" | "area" | "pie" | "boxplot" | "heatmap"
  data: any[]
  xField: string
  yField: string
  colorField?: string
  title: string
  subtitle?: string
  xAxisLabel?: string
  yAxisLabel?: string
  useAggregates?: boolean // For boxplot with pre-computed stats
}

interface ChartResult {
  success: boolean
  spec?: any
  error?: string
}

/**
 * Builds a Vega-Lite chart specification based on the provided parameters
 */
export async function buildChartSpec(params: ChartParams): Promise<ChartResult> {
  const {
    chartType,
    data,
    xField,
    yField,
    colorField,
    title,
    subtitle,
    xAxisLabel,
    yAxisLabel,
    useAggregates = false,
  } = params

  // Use shared configuration for consistency
  const { VEGA_BASE_CONFIG, CHART_CONSTRAINTS } = await import("@/lib/vega-config")

  // Validate data volume
  if (data.length > CHART_CONSTRAINTS.MAX_DATA_POINTS) {
    return {
      success: false,
      error: `Dataset too large (${data.length} points). Maximum is ${CHART_CONSTRAINTS.MAX_DATA_POINTS}. Consider aggregating data first.`,
    }
  }

  // Determine field types with enhanced discrete integer detection
  const sampleValue = data[0]?.[xField]
  // Stricter temporal detection: must be string-like date format, not bare integers
  // Prevents integers (1, 2, 3...) from being treated as timestamps
  const isXTemporal = typeof sampleValue === "string"
                     && !isNaN(Date.parse(sampleValue))
                     && isNaN(Number(sampleValue))

  // Enhanced type detection for x-axis: distinguish discrete integer sequences from continuous numeric data
  let xType: string
  if (isXTemporal) {
    xType = "temporal"
  } else if (typeof sampleValue === "number") {
    // Check if this is a discrete integer sequence (like buckets 1-10, ratings 1-5, etc.)
    const uniqueXValues = new Set(data.map(d => d[xField]))
    const isAllIntegers = Array.from(uniqueXValues).every(v => typeof v === 'number' && Number.isInteger(v))
    const isDiscrete = uniqueXValues.size <= 20 && isAllIntegers

    // Use ordinal for discrete integer sequences (ensures all labels show), quantitative for continuous
    xType = isDiscrete ? "ordinal" : "quantitative"
  } else {
    xType = "nominal"
  }

  // Analyze y-values to determine optimal format (for rates vs counts)
  const yValues = data.map(d => d[yField]).filter(v => typeof v === 'number' && !isNaN(v))
  const maxYValue = yValues.length > 0 ? Math.max(...yValues) : 1

  // Use 2 decimal places for rates/percentages (0-2 range), integers for larger values
  const yAxisFormat = (maxYValue < 2 && maxYValue > 0) ? ",.2f" : ",.0f"
  const tooltipFormat = yAxisFormat

  // Analyze x-values to determine optimal format (for scatter plots with quantitative x-axis)
  const xValues = data.map(d => d[xField]).filter(v => typeof v === 'number' && !isNaN(v))
  const maxXValue = xValues.length > 0 ? Math.max(...xValues) : 1
  const xAxisFormat = (maxXValue < 2 && maxXValue > 0) ? ",.2f" : ",.0f"

  // Base spec with accessibility and data handling best practices
  let spec: any = {
    $schema: "https://vega.github.io/schema/vega-lite/v5.json",
    description: `${title}. ${chartType} chart showing ${yAxisLabel || yField} by ${xAxisLabel || xField}`, // Enhanced screen reader description
    width: "container" as any, // Responsive to zoom and resize
    height: CHART_CONSTRAINTS.DEFAULT_HEIGHT,
    autosize: {
      type: "fit" as const,
      contains: "padding" as const,
    },
    data: { values: data },
    config: VEGA_BASE_CONFIG,
  }

  // Chart-specific configurations with invalid data handling
  if (chartType === "bar") {
    spec.mark = {
      type: "bar",
      cornerRadiusEnd: 4,
      tooltip: true,
      invalid: "filter", // Exclude null/NaN values
      ...(data.length > 20 && { discreteBandSize: 25 }), // Thinner bars for many categories
    }
    spec.encoding = {
      x: {
        field: xField,
        type: xType,
        axis: {
          title: xAxisLabel || xField,
          labelAngle: xType === "nominal" && data.length > 8 ? -45 : 0,
          labelOverlap: "greedy",
          labelPadding: 5,
          labelLimit: 100,
          ...((xType === "quantitative" || xType === "ordinal") && { format: xAxisFormat }),
        },
      },
      y: {
        field: yField,
        type: "quantitative",
        axis: {
          format: yAxisFormat,
          title: yAxisLabel || yField,
        },
      },
      ...(colorField ? {
        color: {
          field: colorField,
          type: "nominal",
          scale: { scheme: "tableau10" },
          legend: {
            title: colorField,
            titleFontSize: 12,
            labelFontSize: 11,
            labelLimit: 150,
            symbolSize: 100,
          },
        },
      } : {
        color: { value: "#1f77b4" }, // Tableau10 blue - colorblind-safe
      }),
      tooltip: [
        { field: xField, type: xType, title: xAxisLabel || xField, ...(isXTemporal && { format: "%B %d, %Y" }), ...((xType === "quantitative" || xType === "ordinal") && !isXTemporal && { format: xAxisFormat }) },
        { field: yField, type: "quantitative", title: yAxisLabel || yField, format: tooltipFormat },
        ...(colorField ? [{ field: colorField, type: "nominal", title: colorField }] : []),
      ],
    }
  } else if (chartType === "line") {
    // Determine x-axis label angle based on data density
    const uniqueXCount = new Set(data.map(d => d[xField])).size
    const xLabelAngle = uniqueXCount > 10 ? -45 : 0

    spec.mark = {
      type: "line",
      point: true,
      tooltip: true,
      strokeWidth: 2,
      invalid: "break-paths-show-domains", // Break line at nulls but keep in scale
    }
    spec.encoding = {
      x: {
        field: xField,
        type: xType,
        axis: {
          title: xAxisLabel || xField,
          labelAngle: xLabelAngle,
          labelOverlap: "greedy" as const, // Prevent label overlap
          labelPadding: 5,
          labelLimit: 100,
          ...((xType === "quantitative" || xType === "ordinal") && { format: xAxisFormat }),
        },
      },
      y: {
        field: yField,
        type: "quantitative",
        axis: { format: yAxisFormat, title: yAxisLabel || yField },
      },
      // Optional color encoding by field
      ...(colorField ? {
        color: {
          field: colorField,
          type: "nominal" as const,
          scale: { scheme: "tableau10" }, // Colorblind-safe palette
          legend: { title: colorField },
        },
      } : {
        color: { value: "#1f77b4" }, // Tableau10 blue - colorblind-safe
      }),
      tooltip: [
        { field: xField, type: xType, title: xAxisLabel || xField, ...(isXTemporal && { format: "%B %d, %Y" }), ...((xType === "quantitative" || xType === "ordinal") && !isXTemporal && { format: xAxisFormat }) },
        { field: yField, type: "quantitative", title: yAxisLabel || yField, format: tooltipFormat },
        ...(colorField ? [{ field: colorField, type: "nominal", title: colorField }] : []),
      ],
    }
  } else if (chartType === "scatter") {
    spec.mark = {
      type: "circle",
      size: 80,
      opacity: 0.7,
      tooltip: true,
      invalid: "filter", // Exclude null/NaN values
    }
    spec.encoding = {
      x: {
        field: xField,
        type: "quantitative",
        axis: {
          format: xAxisFormat,
          title: xAxisLabel || xField,
          labelOverlap: "greedy" as const,
          labelPadding: 5,
          labelLimit: 100,
        },
      },
      y: {
        field: yField,
        type: "quantitative",
        axis: {
          format: yAxisFormat,
          title: yAxisLabel || yField,
          labelOverlap: "greedy" as const,
          labelPadding: 5,
          labelLimit: 100,
        },
      },
      // Optional color encoding by field
      ...(colorField ? {
        color: {
          field: colorField,
          type: "nominal" as const,
          scale: { scheme: "tableau10" }, // Colorblind-safe palette
          legend: { title: colorField },
        },
      } : {
        color: { value: "#1f77b4" }, // Tableau10 blue - colorblind-safe
      }),
      tooltip: [
        { field: xField, type: "quantitative", title: xAxisLabel || xField, format: xAxisFormat },
        { field: yField, type: "quantitative", title: yAxisLabel || yField, format: yAxisFormat },
        ...(colorField ? [{ field: colorField, type: "nominal", title: colorField }] : []),
      ],
    }
  } else if (chartType === "area") {
    // Determine x-axis label angle based on data density
    const uniqueXCount = new Set(data.map(d => d[xField])).size
    const xLabelAngle = uniqueXCount > 10 ? -45 : 0

    spec.mark = {
      type: "area",
      line: true,
      point: false,
      tooltip: true,
      invalid: "break-paths-show-domains", // Break area at nulls but keep in scale
    }
    spec.encoding = {
      x: {
        field: xField,
        type: xType,
        axis: {
          title: xAxisLabel || xField,
          labelAngle: xLabelAngle,
          labelOverlap: "greedy" as const, // Prevent label overlap
          labelPadding: 5,
          labelLimit: 100,
          ...((xType === "quantitative" || xType === "ordinal") && { format: xAxisFormat }),
        },
      },
      y: {
        field: yField,
        type: "quantitative",
        axis: { format: yAxisFormat, title: yAxisLabel || yField },
      },
      // Optional color encoding by field
      ...(colorField ? {
        color: {
          field: colorField,
          type: "nominal" as const,
          scale: { scheme: "tableau10" }, // Colorblind-safe palette
          legend: { title: colorField },
        },
      } : {
        color: { value: "#1f77b4" }, // Tableau10 blue - colorblind-safe
      }),
      tooltip: [
        { field: xField, type: xType, title: xAxisLabel || xField, ...(isXTemporal && { format: "%B %d, %Y" }), ...((xType === "quantitative" || xType === "ordinal") && !isXTemporal && { format: xAxisFormat }) },
        { field: yField, type: "quantitative", title: yAxisLabel || yField, format: tooltipFormat },
        ...(colorField ? [{ field: colorField, type: "nominal", title: colorField }] : []),
      ],
    }
  } else if (chartType === "pie") {
    // Validate category count (pie charts with >10 slices are hard to read)
    const uniqueCategories = new Set(data.map(d => d[xField])).size
    if (uniqueCategories > 10) {
      console.warn(`⚠️  Pie chart has ${uniqueCategories} categories. Consider using a bar chart for better readability.`)
    }

    spec.mark = {
      type: "arc",
      tooltip: true,
      invalid: "filter", // Exclude null/NaN values
      innerRadius: 0, // Use 50 for donut chart
      outerRadius: 120,
    }
    spec.encoding = {
      theta: {
        field: yField,
        type: "quantitative",
        stack: true,
      },
      color: {
        field: xField,
        type: "nominal",
        scale: { scheme: "tableau10" }, // Colorblind-safe palette
        legend: {
          title: xAxisLabel || xField,
          orient: "right",
          labelLimit: 150,
        },
      },
      tooltip: [
        { field: xField, type: "nominal", title: xAxisLabel || xField },
        { field: yField, type: "quantitative", title: yAxisLabel || yField, format: tooltipFormat },
      ],
    }
    spec.view = { stroke: null }
  } else if (chartType === "boxplot") {
    // Validate: box plots need categorical x and quantitative y
    const sampleXValue = data[0]?.[xField]
    const isXCategorical = typeof sampleXValue === "string" || (typeof sampleXValue === "number" && Number.isInteger(sampleXValue))

    if (!isXCategorical) {
      console.warn(`⚠️  Box plot requires categorical x-axis. Consider using scatter plot instead.`)
    }

    if (useAggregates) {
      // Aggregate mode: Build boxplot from pre-computed statistics
      // Data format: {xField, min, q1, median, q3, max, count}
      console.log("Building boxplot from aggregate statistics")

      const uniqueCategories = data.length
      const xLabelAngle = uniqueCategories > 10 ? -45 : 0

      // Use layer composition to build boxplot from aggregated data
      spec.layer = [
        // Whiskers (min to max range)
        {
          mark: { type: "rule", size: 1 },
          encoding: {
            x: {
              field: xField,
              type: "nominal",
              axis: {
                title: xAxisLabel || xField,
                labelAngle: xLabelAngle,
                labelOverlap: "greedy" as const,
                labelPadding: 5,
                labelLimit: 100,
              },
            },
            y: {
              field: "min",
              type: "quantitative",
              scale: { zero: false },
              axis: {
                format: yAxisFormat,
                title: yAxisLabel || yField,
              },
            },
            y2: { field: "max" },
          },
        },
        // Box (q1 to q3 IQR)
        {
          mark: {
            type: "bar",
            size: uniqueCategories > 20 ? 10 : uniqueCategories > 10 ? 20 : 40,
          },
          encoding: {
            x: {
              field: xField,
              type: "nominal",
            },
            y: { field: "q1", type: "quantitative" },
            y2: { field: "q3" },
            color: {
              field: xField,
              type: "nominal",
              scale: { scheme: "tableau10" },
              legend: null,
            },
          },
        },
        // Median line
        {
          mark: { type: "tick", color: "white", size: uniqueCategories > 20 ? 10 : uniqueCategories > 10 ? 20 : 40 },
          encoding: {
            x: {
              field: xField,
              type: "nominal",
            },
            y: { field: "median", type: "quantitative" },
          },
        },
      ]

      // Add tooltip layer for interactivity
      spec.layer.push({
        mark: { type: "bar", size: uniqueCategories > 20 ? 10 : uniqueCategories > 10 ? 20 : 40, opacity: 0 },
        encoding: {
          x: { field: xField, type: "nominal" },
          y: { field: "q1", type: "quantitative" },
          y2: { field: "q3" },
          tooltip: [
            { field: xField, type: "nominal", title: xAxisLabel || xField },
            { field: "min", type: "quantitative", title: `Min ${yAxisLabel || yField}`, format: tooltipFormat },
            { field: "q1", type: "quantitative", title: `Q1 ${yAxisLabel || yField}`, format: tooltipFormat },
            { field: "median", type: "quantitative", title: `Median ${yAxisLabel || yField}`, format: tooltipFormat },
            { field: "q3", type: "quantitative", title: `Q3 ${yAxisLabel || yField}`, format: tooltipFormat },
            { field: "max", type: "quantitative", title: `Max ${yAxisLabel || yField}`, format: tooltipFormat },
            { field: "count", type: "quantitative", title: "Count", format: ",.0f" },
          ],
        },
      })
    } else {
      // Raw data mode: Let Vega-Lite compute statistics
      // Validate: box plots need multiple raw data points per category (not aggregated data)
      const pointsPerCategory = new Map<any, number>()
      data.forEach(d => {
        const cat = d[xField]
        pointsPerCategory.set(cat, (pointsPerCategory.get(cat) || 0) + 1)
      })

      const minPointsPerCategory = Math.min(...Array.from(pointsPerCategory.values()))

      if (minPointsPerCategory < 3) {
        return {
          success: false,
          error: `Boxplot requires multiple raw data points per category (found ${minPointsPerCategory} point${minPointsPerCategory === 1 ? '' : 's'} per category). Your data appears to be pre-aggregated (e.g., using AVG, COUNT, SUM). Use a bar chart to compare aggregated values across categories instead.`
        }
      }

      // Determine x-axis label angle based on number of categories
      const uniqueCategories = new Set(data.map(d => d[xField])).size
      const xLabelAngle = uniqueCategories > 10 ? -45 : 0

      spec.mark = {
        type: "boxplot",
        extent: "min-max", // Show full range including outliers
        size: uniqueCategories > 20 ? 10 : uniqueCategories > 10 ? 20 : 40, // Adaptive box width
        tooltip: true,
        invalid: "filter", // Exclude null/NaN values
      }
      spec.encoding = {
        x: {
          field: xField,
          type: "nominal",
          axis: {
            title: xAxisLabel || xField,
            labelAngle: xLabelAngle,
            labelOverlap: "greedy" as const,
            labelPadding: 5,
            labelLimit: 100,
          },
        },
        y: {
          field: yField,
          type: "quantitative",
          axis: {
            format: yAxisFormat,
            title: yAxisLabel || yField,
          },
          scale: {
            zero: false, // Don't force zero baseline for better distribution visibility
          },
        },
        color: {
          field: xField,
          type: "nominal",
          scale: { scheme: "tableau10" }, // Colorblind-safe palette
          legend: null, // Hide legend (redundant with x-axis)
        },
        tooltip: [
          { field: xField, type: "nominal", title: xAxisLabel || xField },
          { field: yField, type: "quantitative", title: `${yAxisLabel || yField} (Range)`, format: tooltipFormat },
        ],
      }
    }
  } else if (chartType === "heatmap") {
    // Validate: heatmap needs categorical x, categorical y, and a quantitative value field
    // Requires aggregated data (one row per x,y combination)
    const sampleXValue = data[0]?.[xField]
    const sampleYValue = data[0]?.[yField]

    const isXCategorical = typeof sampleXValue === "string" || typeof sampleXValue === "number"
    const isYCategorical = typeof sampleYValue === "string" || typeof sampleYValue === "number"

    if (!isXCategorical || !isYCategorical) {
      console.warn(`⚠️  Heatmap requires categorical x and y axes.`)
    }

    // Determine the value field for color encoding
    // If colorField is specified, use it; otherwise use yField as the value
    const valueField = colorField || yField

    // Check if we have numeric values for the heatmap cells
    // Note: PostgreSQL NUMERIC/DECIMAL types may return as strings to preserve precision
    const sampleValue = data[0]?.[valueField]
    const numericValue = typeof sampleValue === 'string' ? parseFloat(sampleValue) : sampleValue

    if (typeof numericValue !== "number" || isNaN(numericValue)) {
      return {
        success: false,
        error: `Heatmap requires a quantitative value field for color encoding. The field '${valueField}' does not contain numeric values. Please ensure your query includes a numeric aggregation (e.g., COUNT(*), AVG(...), SUM(...)) and specify it via colorField parameter.`
      }
    }

    // Validate: heatmap should have aggregated data (ideally one value per x,y combo)
    const xyPairs = new Map<string, number>()
    data.forEach(d => {
      const key = `${d[xField]}|${d[yField]}`
      xyPairs.set(key, (xyPairs.get(key) || 0) + 1)
    })

    const duplicates = Array.from(xyPairs.values()).filter(count => count > 1).length
    if (duplicates > 0) {
      console.warn(`⚠️  Heatmap has ${duplicates} duplicate x,y combinations. Data should be aggregated with GROUP BY ${xField}, ${yField}.`)
    }

    // Determine axis label angles based on category counts
    const uniqueXCategories = new Set(data.map(d => d[xField])).size
    const uniqueYCategories = new Set(data.map(d => d[yField])).size
    const xLabelAngle = uniqueXCategories > 10 ? -45 : 0

    // Warn if too many categories (readability issue)
    if (uniqueXCategories > 30 || uniqueYCategories > 30) {
      console.warn(`⚠️  Heatmap has ${uniqueXCategories}×${uniqueYCategories} cells. Consider filtering or binning for better readability (recommend ≤30 categories per dimension).`)
    }

    spec.mark = {
      type: "rect",
      tooltip: true,
      invalid: "filter", // Exclude null/NaN values
    }
    spec.encoding = {
      x: {
        field: xField,
        type: "nominal",
        axis: {
          title: xAxisLabel || xField,
          labelAngle: xLabelAngle,
          labelOverlap: "greedy" as const,
          labelPadding: 5,
          labelLimit: 100,
        },
      },
      y: {
        field: yField,
        type: "nominal",
        axis: {
          title: yAxisLabel || yField,
          labelOverlap: "greedy" as const,
        },
      },
      color: {
        field: valueField,
        type: "quantitative",
        scale: {
          scheme: "blues", // Sequential color scheme for quantitative values
          // Can also use "viridis", "magma", "inferno" for better perceptual uniformity
        },
        legend: {
          title: valueField,
          orient: "right",
        },
      },
      tooltip: [
        { field: xField, type: "nominal", title: xAxisLabel || xField },
        { field: yField, type: "nominal", title: yAxisLabel || yField },
        { field: valueField, type: "quantitative", title: valueField, format: tooltipFormat },
      ],
    }
  }

  return {
    success: true,
    spec,
  }
}
