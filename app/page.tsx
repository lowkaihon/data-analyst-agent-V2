"use client"

import type React from "react"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Upload, Github, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB
const MAX_COLUMNS = 30

export default function UploadPage() {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [context, setContext] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  const validateFile = (selectedFile: File): string | null => {
    if (!selectedFile.name.endsWith(".csv")) {
      return "Please upload a CSV file"
    }

    if (selectedFile.size > MAX_FILE_SIZE) {
      return "File size must be less than 20MB"
    }

    return null
  }

  const handleFileSelect = (selectedFile: File) => {
    const validationError = validateFile(selectedFile)
    if (validationError) {
      setError(validationError)
      setFile(null)
      return
    }

    setFile(selectedFile)
    setError(null)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)

    const droppedFile = e.dataTransfer.files[0]
    if (droppedFile) {
      handleFileSelect(droppedFile)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => {
    setIsDragging(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!file) {
      setError("Please select a file")
      return
    }

    setIsUploading(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("context", context)

      const response = await fetch("/api/ingest", {
        method: "POST",
        body: formData,
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to upload file")
      }

      // Redirect to analysis page
      router.push(`/analyze?datasetId=${data.datasetId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred")
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex flex-col gap-1.5">
              <CardTitle className="text-2xl">Data Analyst Agent</CardTitle>
              <CardDescription>Upload your CSV file to start analyzing your data</CardDescription>
            </div>
            <Button variant="ghost" asChild>
              <a href="https://github.com/lowkaihon/data-analyst-agent-V2" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2">
                <Github className="h-4 w-4" />
                GitHub
              </a>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <Label htmlFor="context">Describe your data (optional)</Label>
              <Textarea
                id="context"
                placeholder="Provide context about your data (e.g., 'This is sales data from Q4 2024' or 'Customer demographics from our CRM system')"
                value={context}
                onChange={(e) => setContext(e.target.value)}
                rows={4}
                className="resize-none"
              />
              <p className="text-sm text-muted-foreground">
                This information will help the AI better understand and analyze your data.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label>Upload CSV File</Label>
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                className={`flex flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed p-12 transition-colors ${
                  isDragging ? "border-primary bg-accent" : "border-border"
                }`}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                  <Upload className="h-6 w-6 text-muted-foreground" />
                </div>
                <div className="flex flex-col items-center gap-1 text-center">
                  <p className="text-lg font-medium">Upload CSV File</p>
                  <p className="text-sm text-muted-foreground">Drag and drop your CSV file here, or click to browse</p>
                  <p className="text-xs text-muted-foreground">Maximum file size: 20MB, Maximum columns: 30</p>
                </div>
                <Button type="button" variant="outline" onClick={() => document.getElementById("file-input")?.click()}>
                  Choose File
                </Button>
                <input
                  id="file-input"
                  type="file"
                  accept=".csv"
                  onChange={(e) => {
                    const selectedFile = e.target.files?.[0]
                    if (selectedFile) {
                      handleFileSelect(selectedFile)
                    }
                  }}
                  className="hidden"
                />
                {file && (
                  <p className="text-sm font-medium text-foreground">
                    Selected: {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
                  </p>
                )}
                {error && (
                  <div className="w-full rounded-md bg-destructive/10 px-4 py-3 text-center">
                    <p className="text-sm font-medium text-destructive">{error}</p>
                  </div>
                )}
                <div className="w-full text-left space-y-1 px-4 py-3 bg-muted/50 rounded-md">
                  <p className="text-xs font-medium text-muted-foreground">Privacy Notice:</p>
                  <ul className="text-xs text-muted-foreground space-y-0.5">
                    <li>• Data automatically deleted after 24 hours</li>
                    <li>• Query results sent to OpenAI for analysis</li>
                    <li>• Do not upload sensitive data</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Kaggle Dataset Link */}
            <div className="flex items-center justify-center gap-2 rounded-md bg-accent/50 px-4 py-3 text-sm">
              <ExternalLink className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">
                Don't have a dataset?{" "}
                <a
                  href="https://www.kaggle.com/datasets/sushant097/bank-marketing-dataset-full"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
                >
                  Download this sample Bank Marketing dataset from Kaggle
                </a>
              </span>
            </div>

            <Button type="submit" disabled={!file || isUploading} className="w-full">
              {isUploading ? "Uploading..." : "Start Analysis"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
