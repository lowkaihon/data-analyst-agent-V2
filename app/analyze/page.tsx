"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable"
import { ChatPanel } from "@/components/chat-panel"
import { DataExplorer } from "@/components/data-explorer"
import { setCurrentDataset, initSessionCleanup } from "@/lib/session-cleanup"

function AnalyzeContent() {
  const searchParams = useSearchParams()
  const datasetId = searchParams.get("datasetId")

  // Report state management
  const [reportContent, setReportContent] = useState<{ title: string; markdown: string } | null>(null)
  const [isGeneratingReport, setIsGeneratingReport] = useState(false)

  // Tab state management
  const [activeTab, setActiveTab] = useState("preview")

  // Artifact refresh trigger - increments when AI streaming ends (refreshes Charts and SQL tabs)
  const [artifactRefreshTrigger, setArtifactRefreshTrigger] = useState(0)

  useEffect(() => {
    if (datasetId) {
      setCurrentDataset(datasetId)
      initSessionCleanup()
    }
  }, [datasetId])

  // Handle report generation
  const handleGenerateReport = async () => {
    if (!datasetId) return

    setIsGeneratingReport(true)
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

      console.log("Report generated successfully")
      setReportContent(result) // { title, markdown }
      setActiveTab("report") // Auto-switch to report tab
    } catch (err) {
      console.error("Failed to generate report:", err)
      // Error will be shown in UI via report tab
    } finally {
      setIsGeneratingReport(false)
    }
  }

  // Handle AI stream end - trigger artifact refresh (Charts and SQL tabs)
  const handleStreamEnd = () => {
    console.log("AI stream ended, triggering artifact refresh")
    setArtifactRefreshTrigger((prev) => prev + 1)
  }

  if (!datasetId) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-muted-foreground">No dataset selected</p>
      </div>
    )
  }

  return (
    <div className="h-screen w-full">
      <ResizablePanelGroup direction="horizontal" className="h-full">
        <ResizablePanel defaultSize={50} minSize={30} className="flex flex-col overflow-hidden">
          <ChatPanel
            datasetId={datasetId}
            onGenerateReport={handleGenerateReport}
            isGeneratingReport={isGeneratingReport}
            onStreamEnd={handleStreamEnd}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={50} minSize={30} className="flex flex-col overflow-hidden">
          <DataExplorer
            datasetId={datasetId}
            reportContent={reportContent}
            onGenerateReport={handleGenerateReport}
            isGeneratingReport={isGeneratingReport}
            artifactRefreshTrigger={artifactRefreshTrigger}
            activeTab={activeTab}
            onActiveTabChange={setActiveTab}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}

export default function AnalyzePage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      }
    >
      <AnalyzeContent />
    </Suspense>
  )
}
