"use client"

import { useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Database, BarChart3, FileText } from "lucide-react"
import { PreviewTab } from "@/components/tabs/preview-tab"
import { SchemaTab } from "@/components/tabs/schema-tab"
import { SQLTab } from "@/components/tabs/sql-tab"
import { ChartsTab } from "@/components/tabs/charts-tab"
import { ReportTab } from "@/components/tabs/report-tab"
import { HistoryDrawer } from "@/components/history-drawer"

interface DatasetTabsProps {
  datasetId: string
}

export function DatasetTabs({ datasetId }: DatasetTabsProps) {
  const [activeTab, setActiveTab] = useState("preview")

  return (
    <div className="flex h-full flex-col">
      {/* Header with History button */}
      <div className="flex items-center justify-between border-b bg-background p-4">
        <h2 className="text-lg font-semibold">Dataset</h2>
        <HistoryDrawer datasetId={datasetId} />
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
        <TabsList className="w-full justify-start rounded-none border-b bg-background px-4">
          <TabsTrigger value="preview" className="gap-2">
            <Database className="h-4 w-4" />
            Preview
          </TabsTrigger>
          <TabsTrigger value="schema" className="gap-2">
            <FileText className="h-4 w-4" />
            Schema
          </TabsTrigger>
          <TabsTrigger value="sql" className="gap-2">
            <FileText className="h-4 w-4" />
            SQL
          </TabsTrigger>
          <TabsTrigger value="charts" className="gap-2">
            <BarChart3 className="h-4 w-4" />
            Charts
          </TabsTrigger>
          <TabsTrigger value="report" className="gap-2">
            <FileText className="h-4 w-4" />
            Report
          </TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-hidden">
          <TabsContent value="preview" className="h-full m-0">
            <PreviewTab datasetId={datasetId} />
          </TabsContent>
          <TabsContent value="schema" className="h-full m-0">
            <SchemaTab datasetId={datasetId} />
          </TabsContent>
          <TabsContent value="sql" className="h-full m-0">
            <SQLTab datasetId={datasetId} />
          </TabsContent>
          <TabsContent value="charts" className="h-full m-0">
            <ChartsTab datasetId={datasetId} />
          </TabsContent>
          <TabsContent value="report" className="h-full m-0">
            <ReportTab datasetId={datasetId} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  )
}
