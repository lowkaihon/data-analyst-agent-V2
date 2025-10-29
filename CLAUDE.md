# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- `pnpm dev` - Start development server with Turbopack
- `pnpm build` - Build production app with Turbopack
- `pnpm start` - Start production server
- `pnpm tsc --noEmit` - Run TypeScript compiler to check for type errors

## Code Quality

**IMPORTANT**: Always run `pnpm tsc --noEmit` after writing or modifying any code to ensure there are no TypeScript errors before considering the task complete.

## Package Manager

This project strictly uses **pnpm**. Do not use npm or yarn.

## Project Structure

```
├── app/
│   ├── page.tsx                    # Upload interface (Stage 0)
│   ├── layout.tsx                  # Root layout
│   ├── globals.css                 # Global styles
│   ├── analyze/
│   │   ├── page.tsx                # Split-view analysis (Stage 1)
│   │   └── loading.tsx             # Suspense boundary
│   └── api/
│       ├── chat/[datasetId]/route.ts       # AI chat with tools
│       ├── datasets/cleanup/route.ts       # Dataset deletion
│       ├── ingest/route.ts                 # CSV upload and table creation
│       ├── preview/route.ts                # Data preview endpoint
│       ├── schema/route.ts                 # Schema metadata endpoint
│       ├── runs/
│       │   ├── route.ts                    # Artifact management
│       │   └── [id]/pin/route.ts           # Pin/unpin artifacts
│       └── report/generate/route.ts        # Report generation
├── components/
│   ├── chat-panel.tsx              # Chat interface with AI SDK
│   ├── data-explorer.tsx           # Data explorer with tabbed views
│   ├── history-drawer.tsx          # Artifact search and filter (in development)
│   ├── theme-provider.tsx          # Theme context provider
│   ├── vega-lite-chart.tsx         # Vega-Lite visualization wrapper
│   ├── ai-elements/                # AI-powered UI components (currently using: message.tsx, tool.tsx)
│   ├── tabs/
│   │   ├── charts-tab.tsx          # Visualization gallery
│   │   ├── preview-tab.tsx         # Data preview table
│   │   ├── report-tab.tsx          # Report generation UI
│   │   ├── schema-tab.tsx          # Schema browser
│   │   └── sql-tab.tsx             # Query history
│   └── ui/                         # shadcn/ui component library
├── lib/
│   ├── postgres.ts                 # Direct Postgres connection
│   ├── session-cleanup.ts          # Session management utilities
│   ├── sql-guard.ts                # SQL safety validation
│   ├── types.ts                    # TypeScript definitions
│   ├── utils.ts                    # Utility functions
│   ├── ...                         # Additional utilities (vega-config, vega-validator, response-parser, etc.)
│   └── supabase/
│       ├── client.ts               # Supabase client (browser)
│       └── server.ts               # Supabase client (server)
├── scripts/
│   ├── reset_database.sql          # Database reset script
│   └── initialize_database.sql     # Database initialization
├── components.json                 # shadcn/ui configuration
├── next.config.mjs                 # Next.js configuration
├── postcss.config.mjs              # PostCSS configuration
├── tsconfig.json                   # TypeScript configuration
├── package.json                    # Dependencies
├── pnpm-lock.yaml                  # Lock file
├── middleware.ts                   # Anonymous authentication middleware
├── CLAUDE.md                       # Development guidance for Claude Code
├── RLS_IMPLEMENTATION.md           # RLS security implementation guide
└── README.md                       # Project documentation
```

## AI SDK Integration

### Server-Side: streamText() for API Routes

Uses AI SDK 5's `streamText()` for streaming responses with tools:

```typescript
import { streamText, convertToModelMessages, stepCountIs } from 'ai'
import { openai } from '@ai-sdk/openai'

export async function POST(req: Request) {
  const { messages, schema, sample } = await req.json()

  // Convert UIMessages to ModelMessages
  const modelMessages = convertToModelMessages(messages)

  const result = streamText({
    model: openai("gpt-5"),
    tools: { executeSQLQuery: sqlExecutorBridgeTool },
    system: systemPrompt,
    messages: modelMessages,
    stopWhen: stepCountIs(10), // Multi-step tool calling
  })

  // Return UIMessageStreamResponse for useChat compatibility
  return result.toUIMessageStreamResponse()
}
```

**Critical patterns:**
- Use `convertToModelMessages()` to convert UIMessages from useChat
- Use `toUIMessageStreamResponse()` to return compatible stream for useChat
- Tool results automatically appear in message.parts array
- Use `stepCountIs(n)` for multi-step tool execution

### Client-Side: useChat() for Components

**CRITICAL**: Read the docs before using: https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat

```typescript
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"

const { messages, status, sendMessage } = useChat({
  transport: new DefaultChatTransport({
    api: "/api/chat",
    body: {
      // Additional context (not messages)
      schema,
      sample,
      rowCount,
    },
  }),
})

// CRITICAL: Only send UIMessage-compatible objects
sendMessage({ text: "message content" })  // ✅ CORRECT
sendMessage("string")                      // ❌ WRONG - causes runtime errors
```

**Message structure:**
- Messages use `parts` array, NOT `content` field
- Access text: `message.parts?.filter(p => p.type === "text").map(p => p.text).join("")`
- Tool calls: `message.parts?.filter(p => p.type?.startsWith("tool-"))`
- Tool states: `input-streaming`, `input-available`, `output-available`, `output-error`

Requires environment variables in `.env.local`

## AI SDK Tools

**CRITICAL REQUIREMENT**: You MUST read the AI SDK tools documentation before working with tools: https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling

**ALSO REQUIRED**: Read the manual agent loop cookbook for advanced patterns: https://ai-sdk.dev/cookbook/node/manual-agent-loop

This documentation is essential for understanding:
- How tools are called by language models
- Tool execution flow and lifecycle
- Tool choice strategies (`auto`, `required`, `none`, specific tool)
- Multi-step tool calling with `stopWhen` and `stepCountIs()`
- Tool call monitoring and error handling
- Manual agent loops for complex tool workflows

### Data Streaming with Tools

**IMPORTANT**: Always read the AI SDK data streaming documentation when working with custom data parts: https://ai-sdk.dev/docs/ai-sdk-ui/streaming-data



##### Types of Streamable Data

1. **Tool Results**: Automatically streamed when tools return data
2. **Sources**: Can be included in tool results for RAG implementations
3. **Custom Data Parts**: Can be streamed using `streamData` for more complex scenarios

##### Best Practices

- Keep tool return types simple to avoid TypeScript deep instantiation errors
- Include sources directly in tool results for automatic streaming
- Use the `toUIMessageStreamResponse()` method for proper client compatibility
- Tool results are automatically included in the message parts array

### Multi-Step Tool Execution with stepCountIs()

**IMPORTANT**: The AI SDK API has evolved (v5.0.44+). Always use current patterns:

```typescript
const result = streamText({
  model: openai("gpt-5"),
  messages: modelMessages,
  tools: { executeSQLQuery },
  stopWhen: stepCountIs(10), // CURRENT API - replaces deprecated maxSteps
});
```

### Tool Choice Strategies

Control how and when tools are called using the `toolChoice` parameter:

```typescript
const result = streamText({
  model: openai("gpt-5"),
  messages: modelMessages,
  tools: { executeSQLQuery },
  toolChoice: 'auto', // Options: 'auto', 'required', 'none', or specific tool name
  stopWhen: stepCountIs(5),
});
```

- **`auto` (default)**: Model decides whether to call tools based on context
- **`required`**: Model must call at least one tool before responding
- **`none`**: Disable all tool calls
- **Specific tool**: Force a particular tool to be called

### Tool Implementation Guidelines

**Structure**: Each tool uses AI SDK's `tool()` function with:
  - `description`: Clear explanation of the tool's purpose (influences tool selection)
  - `inputSchema`: Zod schema defining input parameters
  - `execute`: Async function performing the tool's action

### Tool Call Monitoring

Add logging in tools to monitor execution:

```typescript
// In tool execute function
execute: async ({ query }) => {
  console.log(`🔍 Tool executing with query: "${query}"`);
  try {
    const result = await performAction(query);
    console.log(`✅ Tool completed successfully`);
    return result;
  } catch (error) {
    console.error(`💥 Tool error:`, error);
    throw error;
  }
}
```

### Tool Call UI Indicators

Display tool execution states using AI Elements:

```typescript
// Example
{message.parts?.filter(part => part.type === "tool").map((part, i) => {
  const toolState = part.result
    ? "output-available"
    : part.input
      ? "input-available"
      : "input-streaming";

  return (
    <Tool defaultOpen={true}>
      <ToolHeader type={`tool-${part.toolName}`} state={toolState} />
      <ToolContent>
        {part.input && <ToolInput input={part.input} />}
        {part.result && <ToolOutput output={part.result} />}
        {toolState === "input-streaming" && (
          <div>🔍 Executing SQL query...</div>
        )}
      </ToolContent>
    </Tool>
  );
})}
```

### Tool Call Best Practices

- **Clear Descriptions**: Write detailed descriptions to help the model choose the right tool
- **Specific Input Schemas**: Use descriptive Zod schemas with `.describe()` for parameters
- **Error Handling**: Always wrap tool execution in try-catch blocks
- **Logging**: Add console logging to track tool usage and debug issues
- **Return Structure**: Keep return types simple to avoid TypeScript complexity
- **UI Feedback**: Always show tool execution state using AI Elements components

## UI Components

### shadcn/ui Configuration

- New York style
- Neutral base color with CSS variables
- Import aliases: `@/components`, `@/lib`, `@/lib/utils`, `@/components/ui`, `@/hooks`
- Lucide React for icons

### AI Elements Components

- Pre-built components for AI applications
- Located in `components/ai-elements/`
- Available components include: Conversation, Message, PromptInput, Sources, Tool, Reasoning, and more
- Supports tool calls, sources, reasoning tokens, and rich message formatting
- Use only the components needed for your specific implementation
- Documentation: https://ai-sdk.dev/elements/components/reasoning#reasoning

### Adding New Components

- **shadcn/ui**: `pnpm dlx shadcn@latest add [component-name]`
- **AI Elements**: `pnpm dlx ai-elements@latest` (adds all components)

