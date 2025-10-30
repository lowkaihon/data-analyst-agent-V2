"use client"

import type React from "react"

import { useState, useEffect, useRef, useLayoutEffect } from "react"
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
import { FormattedResponse } from "@/components/formatted-response"
import type { ToolUIPart } from "ai"

interface ChatPanelProps {
  datasetId: string
  onGenerateReport?: () => void
  isGeneratingReport?: boolean
  onStreamEnd?: () => void
}

const DEEP_DIVE_PROMPT = `Conduct a comprehensive analysis to identify actionable insights. Explore individual feature relationships with the target variable, multi-dimensional interactions between features, and key patterns or segments. Use exploratory analysis, visualization, statistical validation, and synthesis to deliver data-driven recommendations.`

export function ChatPanel({ datasetId, onGenerateReport, isGeneratingReport, onStreamEnd }: ChatPanelProps) {
  const [input, setInput] = useState("")
  const hasInitializedRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [showDeepDiveDialog, setShowDeepDiveDialog] = useState(false)
  const [deepDivePrompt, setDeepDivePrompt] = useState(DEEP_DIVE_PROMPT)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const prevStatusRef = useRef<string>("ready")
  const isInitialMountRef = useRef(true)
  const [hasUserScrolledAway, setHasUserScrolledAway] = useState(false)

  console.log("ChatPanel initialized with datasetId:", datasetId)

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: `/api/chat/${datasetId}`,
    }),
    onError: (error) => {
      console.error("Chat error:", error)
      setError(error.message)
    },
    onFinish: (message) => {
      console.log("Chat finished:", message)
    },
  })

  console.log("Chat status:", status, "Messages count:", messages.length)

  useEffect(() => {
    if (!hasInitializedRef.current && status === "ready" && messages.length === 0) {
      console.log("Sending initial greeting message")
      hasInitializedRef.current = true
      try {
        sendMessage({ text: "__INIT__" }, { body: { mode: "normal" } })
      } catch (err) {
        console.error("Error sending init message:", err)
        setError(err instanceof Error ? err.message : "Failed to send initial message")
      }
    }
  }, [status, messages.length, sendMessage])

  // Detect manual scrolling to track user intent
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) return

    const handleScroll = () => {
      const { scrollHeight, scrollTop, clientHeight } = scrollContainer
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight

      // User is at bottom (within 100px threshold)
      if (distanceFromBottom < 100) {
        setHasUserScrolledAway(false)
      }
      // User has scrolled away from bottom
      else if (distanceFromBottom > 150) {
        setHasUserScrolledAway(true)
      }
    }

    scrollContainer.addEventListener("scroll", handleScroll, { passive: true })
    return () => scrollContainer.removeEventListener("scroll", handleScroll)
  }, [])

  // Auto-scroll to bottom when messages change (non-blocking for better performance)
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current
    const messagesEnd = messagesEndRef.current

    if (!scrollContainer || !messagesEnd) return

    // On initial mount, always scroll to bottom instantly
    if (isInitialMountRef.current) {
      messagesEnd.scrollIntoView({ behavior: "auto" })
      isInitialMountRef.current = false
      return
    }

    // Only auto-scroll if user hasn't manually scrolled away
    if (!hasUserScrolledAway) {
      // Use 'auto' (instant) during streaming to prevent animation conflicts
      // Use 'smooth' when idle for better UX
      const behavior: ScrollBehavior = status === "streaming" ? "auto" : "smooth"
      messagesEnd.scrollIntoView({ behavior })
    }
  }, [messages, status, hasUserScrolledAway])

  // Detect when streaming ends and trigger chart refresh
  useEffect(() => {
    if (prevStatusRef.current === "streaming" && status === "ready") {
      console.log("Stream ended, notifying parent component")
      onStreamEnd?.()
    }
    prevStatusRef.current = status
  }, [status, onStreamEnd])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || status === "streaming" || status === "submitted") return

    console.log("Sending message:", input, "with datasetId:", datasetId)
    try {
      setError(null)
      sendMessage({ text: input }, { body: { mode: "normal" } })
      setInput("")

      // Ensure user hasn't scrolled away flag is reset when they send a message
      setHasUserScrolledAway(false)

      // Scroll to bottom smoothly after sending
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
      }, 100)
    } catch (err) {
      console.error("Error sending message:", err)
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

    console.log("Starting deep dive analysis with mode=deep-dive")
    try {
      setError(null)
      setShowDeepDiveDialog(false)

      // Ensure user hasn't scrolled away flag is reset when starting deep dive
      setHasUserScrolledAway(false)

      // Pass mode in sendMessage options (correct AI SDK pattern)
      sendMessage({ text: deepDivePrompt }, { body: { mode: "deep-dive" } })

      // Scroll to bottom smoothly after starting
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
      }, 100)
    } catch (err) {
      console.error("Error starting deep dive:", err)
      setError(err instanceof Error ? err.message : "Failed to start deep dive")
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
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4">
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
                        <FormattedResponse key={partIndex} text={part.text} />
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
              Deep dive starts with fresh conversation context for unbiased comprehensive analysis.
              All SQL queries and charts remain accessible in their tabs. The analysis uses up to
              30 steps and may take 2-3 minutes. Customize the prompt below to reference specific
              findings if needed.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <p className="text-sm font-medium mb-2">Analysis Prompt:</p>
            <Textarea
              value={deepDivePrompt}
              onChange={(e) => setDeepDivePrompt(e.target.value)}
              className="min-h-[120px] resize-y font-mono text-sm [word-break:break-word] [overflow-wrap:anywhere]"
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
