"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { useChat } from "@ai-sdk/react"
import { Send, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Card } from "@/components/ui/card"

interface ChatPanelProps {
  datasetId: string
}

export function ChatPanel({ datasetId }: ChatPanelProps) {
  const [input, setInput] = useState("")
  const [hasInitialized, setHasInitialized] = useState(false)
  const [error, setError] = useState<string | null>(null)

  console.log("[v0] ChatPanel initialized with datasetId:", datasetId)

  const { messages, sendMessage, status } = useChat({
    api: `/api/chat/${datasetId}`,
    onError: (error) => {
      console.error("[v0] Chat error:", error)
      setError(error.message)
    },
    onFinish: (message) => {
      console.log("[v0] Chat finished:", message)
    },
    onResponse: (response) => {
      console.log("[v0] Chat response received:", response.status, response.statusText)
      if (!response.ok) {
        console.error("[v0] Chat response not OK:", response.status, response.statusText)
      }
    },
  })

  console.log("[v0] Chat status:", status, "Messages count:", messages.length)

  useEffect(() => {
    if (!hasInitialized && status === "ready" && messages.length === 0) {
      console.log("[v0] Sending initial greeting message")
      setHasInitialized(true)
      try {
        sendMessage({ text: "__INIT__" })
      } catch (err) {
        console.error("[v0] Error sending init message:", err)
        setError(err instanceof Error ? err.message : "Failed to send initial message")
      }
    }
  }, [hasInitialized, status, messages.length, sendMessage])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || status === "in_progress") return

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
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b bg-background p-4">
        <h2 className="text-lg font-semibold">Chat</h2>
        <p className="text-sm text-muted-foreground">Ask questions about your data</p>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4">
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

          {messages.map((message) => {
            const isInitMessage =
              message.role === "user" && message.parts.some((p) => p.type === "text" && p.text === "__INIT__")
            if (isInitMessage) return null

            return (
              <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                <Card
                  className={`max-w-[80%] p-3 ${
                    message.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                  }`}
                >
                  {message.parts.map((part, index) => {
                    if (part.type === "text") {
                      return (
                        <p key={index} className="whitespace-pre-wrap text-sm">
                          {part.text}
                        </p>
                      )
                    }
                    return null
                  })}
                </Card>
              </div>
            )
          })}

          {status === "in_progress" && (
            <div className="flex justify-start">
              <Card className="bg-muted p-3">
                <Loader2 className="h-4 w-4 animate-spin" />
              </Card>
            </div>
          )}
        </div>
      </ScrollArea>

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
          <Button type="submit" size="icon" disabled={!input.trim() || status === "in_progress"}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  )
}
