"use client"

import type React from "react"

import { useState, useEffect, useRef } from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { Send, Loader2, Sparkles, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Card } from "@/components/ui/card"
import { Message, MessageContent, MessageAvatar } from "@/components/ai-elements/message"
import { Tool, ToolHeader, ToolContent, ToolInput, ToolOutput } from "@/components/ai-elements/tool"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { ToolUIPart } from "ai"

interface ChatPanelProps {
  datasetId: string
  onGenerateReport?: () => void
  isGeneratingReport?: boolean
}

const DEEP_DIVE_PROMPT = `Conduct a comprehensive analysis to identify actionable insights. Explore individual feature relationships with the target variable, multi-dimensional interactions between features, and key patterns or segments. Use exploratory analysis, visualization, statistical validation, and synthesis to deliver data-driven recommendations.`

export function ChatPanel({ datasetId, onGenerateReport, isGeneratingReport }: ChatPanelProps) {
  const [input, setInput] = useState("")
  const hasInitializedRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [showDeepDiveDialog, setShowDeepDiveDialog] = useState(false)
  const [mode, setMode] = useState<"normal" | "deep-dive">("normal")
  const [deepDivePrompt, setDeepDivePrompt] = useState(DEEP_DIVE_PROMPT)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  console.log("[v0] ChatPanel initialized with datasetId:", datasetId)

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: `/api/chat/${datasetId}`,
      body: {
        mode,
      },
    }),
    onError: (error) => {
      console.error("[v0] Chat error:", error)
      setError(error.message)
    },
    onFinish: (message) => {
      console.log("[v0] Chat finished:", message)
    },
  })

  console.log("[v0] Chat status:", status, "Messages count:", messages.length)

  useEffect(() => {
    if (!hasInitializedRef.current && status === "ready" && messages.length === 0) {
      console.log("[v0] Sending initial greeting message")
      hasInitializedRef.current = true
      try {
        sendMessage({ text: "__INIT__" })
      } catch (err) {
        console.error("[v0] Error sending init message:", err)
        setError(err instanceof Error ? err.message : "Failed to send initial message")
      }
    }
  }, [status, messages.length, sendMessage])

  // Auto-scroll to bottom when messages change or streaming status updates
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, status])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || status === "streaming" || status === "submitted") return

    console.log("[v0] Sending message:", input, "with datasetId:", datasetId)
    try {
      setError(null)
      sendMessage({ text: input })
      setInput("")
    } catch (err) {
      console.error("[v0] Error sending message:", err)
      setError(err instanceof Error ? err.message : "Failed to send message")
    }
  }

  const handleOpenDeepDiveDialog = () => {
    // Reset prompt to default when opening dialog
    setDeepDivePrompt(DEEP_DIVE_PROMPT)
    setShowDeepDiveDialog(true)
  }

  const handleDeepDive = () => {
    if (status === "streaming" || status === "submitted") return

    // Validate prompt is not empty
    if (!deepDivePrompt.trim()) {
      setError("Please enter an analysis prompt")
      return
    }

    console.log("[v0] Starting deep dive analysis with custom prompt:", deepDivePrompt.substring(0, 50) + "...")
    try {
      setError(null)
      setMode("deep-dive")
      setShowDeepDiveDialog(false)
      sendMessage({ text: deepDivePrompt })
    } catch (err) {
      console.error("[v0] Error starting deep dive:", err)
      setError(err instanceof Error ? err.message : "Failed to start deep dive")
      setMode("normal")
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b bg-background p-4 flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">Chat</h2>
          <p className="text-sm text-muted-foreground">Ask questions about your data</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleOpenDeepDiveDialog}
          disabled={status === "streaming" || status === "submitted"}
          className="gap-2"
        >
          <Sparkles className="h-4 w-4" />
          Deep Dive
        </Button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex flex-col gap-4">
          {error && (
            <Card className="border-destructive bg-destructive/10 p-3">
              <p className="text-sm text-destructive">Error: {error}</p>
            </Card>
          )}

          {messages.length === 0 && status === "ready" && !error && (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <p className="text-sm text-muted-foreground">Initializing chat...</p>
              </div>
            </div>
          )}

          {messages.map((message, index) => {
            const isInitMessage =
              message.role === "user" && message.parts.some((p) => p.type === "text" && p.text === "__INIT__")
            if (isInitMessage) return null

            // Count tool calls for summary
            const toolParts = message.parts.filter((p) => p.type?.startsWith("tool-")) as ToolUIPart[]

            return (
              <Message key={`${index}-${message.id}`} from={message.role}>
                {message.role === "assistant" && (
                  <MessageAvatar
                    src="https://api.dicebear.com/7.x/bottts/svg?seed=assistant"
                    name="AI"
                  />
                )}

                <MessageContent variant="flat">
                  {/* Show tool summary if many tools */}
                  {toolParts.length > 3 && (
                    <div className="text-xs text-muted-foreground border-l-2 border-muted pl-3 py-1 mb-2">
                      Executed {toolParts.length} tool calls • Click any to expand
                    </div>
                  )}

                  {/* Render parts in chronological order to preserve streaming sequence */}
                  {message.parts.map((part, partIndex) => {
                    // Render text parts
                    if (part.type === "text" && part.text) {
                      return (
                        <div key={partIndex} className="whitespace-pre-wrap text-sm">
                          {part.text}
                        </div>
                      )
                    }

                    // Render tool parts
                    if (part.type?.startsWith("tool-")) {
                      const toolPart = part as ToolUIPart

                      // Determine tool state based on what data is available
                      const toolState: ToolUIPart["state"] = toolPart.errorText
                        ? "output-error"
                        : toolPart.output !== undefined
                          ? "output-available"
                          : toolPart.input !== undefined
                            ? "input-available"
                            : "input-streaming"

                      return (
                        <Tool key={partIndex} defaultOpen={false}>
                          <ToolHeader type={toolPart.type} state={toolState} />
                          <ToolContent>
                            {toolPart.input ? <ToolInput input={toolPart.input as any} /> : null}
                            {(toolPart.output || toolPart.errorText) ? (
                              <ToolOutput output={toolPart.output as any} errorText={toolPart.errorText} />
                            ) : null}
                            {toolState === "input-streaming" ? (
                              <div className="p-4 text-muted-foreground text-sm">
                                <Loader2 className="inline-block mr-2 h-4 w-4 animate-spin" />
                                Executing tool...
                              </div>
                            ) : null}
                          </ToolContent>
                        </Tool>
                      )
                    }

                    return null
                  })}
                </MessageContent>

                {message.role === "user" && (
                  <MessageAvatar
                    src="https://api.dicebear.com/7.x/avataaars/svg?seed=user"
                    name="You"
                  />
                )}
              </Message>
            )
          })}

          {(status === "streaming" || status === "submitted") && (
            <div className="flex justify-start">
              <Card className="bg-muted p-3">
                <Loader2 className="h-4 w-4 animate-spin" />
              </Card>
            </div>
          )}

          {/* Anchor element for auto-scroll */}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input area */}
      <div className="border-t p-4 space-y-2">
        {/* Generate Report Button */}
        <Button
          onClick={onGenerateReport}
          variant="outline"
          className="w-full"
          disabled={isGeneratingReport || messages.length === 0}
        >
          {isGeneratingReport ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Generating Report...
            </>
          ) : (
            <>
              <FileText className="mr-2 h-4 w-4" />
              Generate Report
            </>
          )}
        </Button>

        {/* Input form */}
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question about your data..."
            disabled={status === "streaming" || status === "submitted"}
            className="flex-1"
          />
          <Button type="submit" size="icon" disabled={!input.trim() || status === "streaming" || status === "submitted"}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>

      {/* Deep Dive Dialog */}
      <Dialog open={showDeepDiveDialog} onOpenChange={setShowDeepDiveDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              Start Deep Dive Analysis
            </DialogTitle>
            <DialogDescription>
              This will run an in-depth exploration of your dataset using up to 30 analysis steps.
              The analysis may take 2-3 minutes to complete.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <p className="text-sm font-medium mb-2">Analysis Prompt:</p>
            <Textarea
              value={deepDivePrompt}
              onChange={(e) => setDeepDivePrompt(e.target.value)}
              className="min-h-[120px] resize-y font-mono text-sm"
              placeholder="Enter your analysis prompt..."
            />
            <p className="text-xs text-muted-foreground mt-1">
              {deepDivePrompt.length} characters • Customize the prompt to focus on specific aspects
            </p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeepDiveDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleDeepDive}
              disabled={status === "streaming" || status === "submitted"}
              className="gap-2"
            >
              <Sparkles className="h-4 w-4" />
              Start Deep Dive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
