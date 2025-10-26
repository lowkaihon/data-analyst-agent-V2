"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Button } from "@/components/ui/button"
import { hasTwoPartFormat, extractExecutiveSummary, extractDetailedAnalysis } from "@/lib/response-parser"

interface FormattedResponseProps {
  text: string
}

export function FormattedResponse({ text }: FormattedResponseProps) {
  const [isOpen, setIsOpen] = useState(false)

  // Check if this is a formatted response (must have BOTH markers to format properly)
  // During streaming, only executive summary marker may be present - show as regular text
  if (!hasTwoPartFormat(text)) {
    // Regular response or incomplete streaming - display as-is
    return (
      <div className="whitespace-pre-wrap text-sm">
        {text}
      </div>
    )
  }

  // Formatted response - extract and format (both markers are present)
  const summary = extractExecutiveSummary(text)
  const detailed = extractDetailedAnalysis(text)

  return (
    <div className="space-y-3">
      {/* Executive Summary */}
      <div className="whitespace-pre-wrap text-sm">
        {summary}
      </div>

      {/* Collapsible Detailed Analysis */}
      {detailed && (
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
            >
              {isOpen ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              <span className="text-xs font-medium">
                {isOpen ? "Hide" : "Show"} Detailed Analysis
              </span>
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <div className="border-l-2 border-muted pl-4 mt-2">
              <div className="whitespace-pre-wrap text-sm text-muted-foreground">
                {detailed}
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}
