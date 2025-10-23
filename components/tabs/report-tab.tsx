"use client"

import { useState } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, Download, FileText } from "lucide-react"

interface ReportTabProps {
  datasetId: string
}

export function ReportTab({ datasetId }: ReportTabProps) {
  const [title, setTitle] = useState("Data Analysis Report")
  const [markdown, setMarkdown] = useState("")
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)

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
    <ScrollArea className="h-full">
      <div className="p-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">Report</h3>
            <p className="text-sm text-muted-foreground">Generate a markdown report from pinned insights</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleGenerateReport} disabled={generating}>
              {generating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <FileText className="mr-2 h-4 w-4" />
                  Generate Report
                </>
              )}
            </Button>
            {markdown && (
              <Button onClick={handleDownload} variant="outline">
                <Download className="mr-2 h-4 w-4" />
                Download
              </Button>
            )}
          </div>
        </div>

        {markdown ? (
          <div className="flex flex-col gap-4">
            <div>
              <Label htmlFor="title">Report Title</Label>
              <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="markdown">Markdown Content</Label>
              <Textarea
                id="markdown"
                value={markdown}
                onChange={(e) => setMarkdown(e.target.value)}
                className="mt-1 min-h-[400px] font-mono text-sm"
              />
            </div>
            <div className="rounded-lg border bg-muted p-4">
              <h4 className="mb-2 text-sm font-semibold">Preview</h4>
              <div className="prose prose-sm max-w-none">
                <pre className="whitespace-pre-wrap text-xs">{markdown}</pre>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-64 items-center justify-center">
            <div className="text-center">
              <FileText className="mx-auto h-12 w-12 text-muted-foreground" />
              <p className="mt-4 text-sm text-muted-foreground">No report generated yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Click "Generate Report" to create one from pinned insights
              </p>
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  )
}
