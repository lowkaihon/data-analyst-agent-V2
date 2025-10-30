"use client"

import { useEffect, useRef, useState } from "react"
import embed from "vega-embed"
import type { VisualizationSpec } from "vega-embed"
import type { View } from "vega"
import { cn } from "@/lib/utils"
import { VEGA_EMBED_OPTIONS } from "@/lib/vega-config"
import { ensureDescription } from "@/lib/vega-validator"

interface VegaLiteChartProps {
  spec: VisualizationSpec
  className?: string
}

export function VegaLiteChart({ spec, className }: VegaLiteChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<View | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    let isCleanedUp = false

    // Ensure spec has description for accessibility (ARIA label)
    const accessibleSpec = ensureDescription(
      spec,
      (spec as any).title || "Data visualization"
    )

    // Create a responsive version of the spec
    // Use "container" width for proper zoom scaling
    const responsiveSpec: VisualizationSpec = {
      ...accessibleSpec,
      width: "container" as any,
      autosize: {
        type: "fit" as const,
        contains: "padding" as const,
      },
      config: {
        ...((spec as any).config || {}),
        view: {
          ...((spec as any).config?.view || {}),
          continuousWidth: 550, // Default width when container can't be determined
        },
        // Provide fallback axis formatting that encoding-level can override
        axisX: {
          ...((spec as any).config?.axisX || {}),
          // Default rotation for readability (encoding-level takes precedence)
          labelAngle: -45,
          labelAlign: "right" as const,
        },
      },
    } as VisualizationSpec

    // Embed the chart with error handling
    const embedChart = async () => {
      try {
        if (!containerRef.current || isCleanedUp) return

        const result = await embed(
          containerRef.current,
          responsiveSpec,
          VEGA_EMBED_OPTIONS
        )

        if (isCleanedUp) {
          // Component unmounted during embed - cleanup immediately
          result.finalize()
          return
        }

        // Store view reference for efficient resize handling
        viewRef.current = result.view

        // ResizeObserver for container resize events
        // This handles window resize, flex layout changes, etc.
        const resizeObserver = new ResizeObserver((entries) => {
          if (!viewRef.current || isCleanedUp) return

          for (const entry of entries) {
            const newWidth = entry.contentRect.width
            if (newWidth > 0) {
              // Trigger Vega's internal resize handling
              // With "container" width, this properly recalculates the chart
              viewRef.current.resize().run()
            }
          }
        })

        if (containerRef.current) {
          resizeObserver.observe(containerRef.current)
        }

        // Handle window resize for zoom changes
        // Zoom changes trigger window resize events
        const handleWindowResize = () => {
          if (viewRef.current && !isCleanedUp) {
            viewRef.current.resize().run()
          }
        }

        window.addEventListener('resize', handleWindowResize)

        return { result, resizeObserver, handleWindowResize }
      } catch (err) {
        console.error("[VegaLiteChart] Embed error:", err)
        setError(err instanceof Error ? err.message : "Failed to render chart")
        return null
      }
    }

    // Execute embed
    const embedPromise = embedChart()

    // Cleanup function - properly handle async finalization
    return () => {
      isCleanedUp = true

      embedPromise.then((refs) => {
        if (refs) {
          // Disconnect observer first
          refs.resizeObserver.disconnect()

          // Remove window resize listener
          window.removeEventListener('resize', refs.handleWindowResize)

          // Then finalize view - this is async but we await in the promise chain
          // Prevents race condition where finalize might not complete
          refs.result.finalize()
        }

        // Clear view reference
        viewRef.current = null
      })
    }
  }, [spec])

  // Error fallback UI
  if (error) {
    return (
      <div
        className={cn(
          "flex min-h-[200px] items-center justify-center rounded border border-destructive/50 bg-destructive/10 p-4",
          className
        )}
      >
        <div className="text-center">
          <p className="text-sm font-medium text-destructive">Failed to render chart</p>
          <p className="mt-1 text-xs text-muted-foreground">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={cn("min-w-0 overflow-hidden w-full", className)}
      role="img"
      aria-label={(spec as any).description || (spec as any).title || "Data visualization"}
    />
  )
}
