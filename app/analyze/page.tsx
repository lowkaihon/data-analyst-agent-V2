"use client"

import { Suspense, useEffect } from "react"
import { useSearchParams } from "next/navigation"
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable"
import { ChatPanel } from "@/components/chat-panel"
import { DatasetTabs } from "@/components/dataset-tabs"
import { setCurrentDataset, initSessionCleanup } from "@/lib/session-cleanup"

function AnalyzeContent() {
  const searchParams = useSearchParams()
  const datasetId = searchParams.get("datasetId")

  useEffect(() => {
    if (datasetId) {
      setCurrentDataset(datasetId)
      initSessionCleanup()
    }
  }, [datasetId])

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
          <ChatPanel datasetId={datasetId} />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={50} minSize={30} className="flex flex-col overflow-hidden">
          <DatasetTabs datasetId={datasetId} />
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
