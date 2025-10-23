"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Download, FileText, Loader2, Eye, Edit } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

interface ReportTabProps {
  datasetId: string
}

export function ReportTab({ datasetId }: ReportTabProps) {
  const [title, setTitle] = useState("Data Analysis Report")
  const [markdown, setMarkdown] = useState("")
  const [generating, setGenerating] = useState(false)
  const [viewMode, setViewMode] = useState<"preview" | "edit">("preview")

  const handleGenerateReport = async () => {
    setGenerating(true)
    try {
      const response = await fetch("/api/report/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ datasetId }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || "Failed to generate report")
      }

      setTitle(result.title)
      setMarkdown(result.markdown)
      setViewMode("preview") // Switch to preview after generation
    } catch (err) {
      console.error("Failed to generate report:", err)
    } finally {
      setGenerating(false)
    }
  }

  const handleDownload = () => {
    const blob = new Blob([markdown], { type: "text/markdown" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${title.toLowerCase().replace(/\s+/g, "-")}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Report</h3>
          <p className="text-sm text-muted-foreground">Generate a comprehensive analysis report</p>
        </div>
        <div className="flex gap-2">
          {/* Preview/Edit Toggle */}
          {markdown.trim() && (
            <Button
              onClick={() => setViewMode(viewMode === "preview" ? "edit" : "preview")}
              size="sm"
              variant="outline"
              className="gap-2"
            >
              {viewMode === "preview" ? (
                <>
                  <Edit className="h-4 w-4" />
                  Edit
                </>
              ) : (
                <>
                  <Eye className="h-4 w-4" />
                  Preview
                </>
              )}
            </Button>
          )}

          {/* Generate Report Button */}
          <Button onClick={handleGenerateReport} size="sm" variant="outline" className="gap-2" disabled={generating}>
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <FileText className="h-4 w-4" />
                Generate Report
              </>
            )}
          </Button>

          {/* Download Button */}
          <Button onClick={handleDownload} size="sm" variant="outline" className="gap-2" disabled={!markdown.trim()}>
            <Download className="h-4 w-4" />
            Download
          </Button>
        </div>
      </div>

      {/* Content Area */}
      {!markdown.trim() ? (
        // Empty state
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <FileText className="mx-auto h-12 w-12 text-muted-foreground" />
            <p className="mt-4 text-sm text-muted-foreground">No report generated yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Click "Generate Report" to create an AI-powered analysis report
            </p>
          </div>
        </div>
      ) : viewMode === "edit" ? (
        // Edit mode
        <div className="flex-1 flex flex-col gap-4 overflow-hidden">
          <div>
            <Label htmlFor="title">Report Title</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1" />
          </div>
          <div className="flex-1 flex flex-col overflow-hidden">
            <Label htmlFor="markdown">Markdown Content</Label>
            <Textarea
              id="markdown"
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
              className="flex-1 mt-1 font-mono text-sm resize-none"
            />
          </div>
        </div>
      ) : (
        // Preview mode
        <div className="flex-1 overflow-auto border rounded-md p-6 prose prose-sm max-w-none dark:prose-invert">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
        </div>
      )}

      {/* Stats Footer */}
      {markdown.trim() && (
        <div className="text-xs text-muted-foreground">
          {markdown.split("\n").length} lines • {markdown.length} characters
        </div>
      )}
    </div>
  )
}
