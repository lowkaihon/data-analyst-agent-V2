"use client"

import { useEffect, useRef } from "react"
import embed from "vega-embed"
import type { VisualizationSpec } from "vega-embed"

interface VegaLiteChartProps {
  spec: VisualizationSpec
  className?: string
}

export function VegaLiteChart({ spec, className }: VegaLiteChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return

    // Embed the Vega-Lite spec
    const result = embed(containerRef.current, spec, {
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

  return <div ref={containerRef} className={className} />
}
