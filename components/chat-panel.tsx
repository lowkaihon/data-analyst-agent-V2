"use client"

import type React from "react"

import { useState, useEffect, useRef } from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { Send, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Card } from "@/components/ui/card"
import { Message, MessageContent, MessageAvatar } from "@/components/ai-elements/message"
import { Tool, ToolHeader, ToolContent, ToolInput, ToolOutput } from "@/components/ai-elements/tool"
import type { ToolUIPart } from "ai"

interface ChatPanelProps {
  datasetId: string
}

export function ChatPanel({ datasetId }: ChatPanelProps) {
  const [input, setInput] = useState("")
  const hasInitializedRef = useRef(false)
  const [error, setError] = useState<string | null>(null)

  console.log("[v0] ChatPanel initialized with datasetId:", datasetId)

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: `/api/chat/${datasetId}`,
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

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b bg-background p-4">
        <h2 className="text-lg font-semibold">Chat</h2>
        <p className="text-sm text-muted-foreground">Ask questions about your data</p>
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

            // Extract text parts
            const textParts = message.parts.filter((p) => p.type === "text")
            const textContent = textParts.map((p) => p.type === "text" ? p.text : "").join("")

            // Extract tool call parts
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
                  {/* Render text content */}
                  {textContent && (
                    <div className="whitespace-pre-wrap text-sm">
                      {textContent}
                    </div>
                  )}

                  {/* Render tool calls */}
                  {toolParts.map((part, i) => {
                    // Determine tool state based on what data is available
                    const toolState: ToolUIPart["state"] = part.errorText
                      ? "output-error"
                      : part.output !== undefined
                        ? "output-available"
                        : part.input !== undefined
                          ? "input-available"
                          : "input-streaming"

                    return (
                      <Tool key={i} defaultOpen={false}>
                        <ToolHeader type={part.type} state={toolState} />
                        <ToolContent>
                          {part.input ? <ToolInput input={part.input as any} /> : null}
                          {(part.output || part.errorText) ? (
                            <ToolOutput output={part.output as any} errorText={part.errorText} />
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
        </div>
      </div>

      {/* Input */}
      <div className="border-t bg-background p-4">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question..."
            className="min-h-[60px] resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                handleSubmit(e)
              }
            }}
          />
          <Button type="submit" size="icon" disabled={!input.trim() || status === "streaming" || status === "submitted"}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  )
}
