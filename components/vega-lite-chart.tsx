"use client"

import { useEffect, useRef } from "react"
import embed from "vega-embed"
import type { VisualizationSpec } from "vega-embed"
import { cn } from "@/lib/utils"

interface VegaLiteChartProps {
  spec: VisualizationSpec
  className?: string
}

export function VegaLiteChart({ spec, className }: VegaLiteChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return

    // Create a responsive version of the spec with rotated x-axis labels
    const responsiveSpec: VisualizationSpec = {
      ...spec,
      width: "container" as const,
      autosize: {
        type: "fit" as const,
        contains: "padding" as const,
        resize: true,
      },
      config: {
        ...((spec as any).config || {}),
        axisX: {
          ...((spec as any).config?.axisX || {}),
          labelAngle: -45,
          labelAlign: "right" as const,
        },
      },
    } as VisualizationSpec

    // Embed the Vega-Lite spec with responsive sizing
    const result = embed(containerRef.current, responsiveSpec, {
      actions: {
        export: true,
        source: false,
        compiled: false,
        editor: false,
      },
      renderer: "canvas",
    })

    // Cleanup function
    return () => {
      result.then((res) => res.finalize())
    }
  }, [spec])

  return <div ref={containerRef} className={cn("min-w-0 overflow-hidden", className)} />
}
