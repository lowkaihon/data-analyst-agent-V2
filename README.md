# Data Analyst Agent

An AI-powered data analysis platform that enables interactive exploration of CSV datasets through natural conversation. Upload your data, ask questions, and let the AI autonomously run SQL queries, generate visualizations, validate findings, and produce comprehensive reports.

[![Deployed on Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-black?style=for-the-badge&logo=vercel)](https://vercel.com/kaihon333haha-5908s-projects/v0-data-analyst-agent)
[![Built with v0](https://img.shields.io/badge/Built%20with-v0.app-black?style=for-the-badge)](https://v0.app/chat/projects/WdUJaFsY9r0)

## Features

### 🤖 AI-Powered Analysis
- **Dual-Model Architecture**: GPT-4o for standard mode (fast, cost-effective) and GPT-5 for deep dive mode (advanced reasoning)
- **Autonomous Agentic Workflow**: 5-stage iterative exploration (EXPLORE → VISUALIZE → REFINE → VALIDATE → SUMMARIZE)
- **Multi-Step Tool Calling**: Up to 10 autonomous tool calls per analysis for standard exploration
- **Deep Dive Mode**: Optional exhaustive analysis with up to 40 steps (30 for exploration, 10 reserved for summary generation)
- **Proactive Drill-Down**: AI automatically investigates spikes, outliers, and patterns without prompting
- **Smart Visualizations**: Generates 5-7 high-impact Vega-Lite charts based on judgment and data patterns
- **Self-Correction**: Retries failed queries with helpful error messages and fix suggestions
- **Token-Efficient Architecture**: Reference-based data flow minimizes token usage while maintaining full data access
- **Contextual Insights**: AI understands your data context and suggests relevant explorations

### 🔬 Deep Dive Analysis
- **One-Click Exhaustive Analysis**: Trigger comprehensive exploration with 30 tool calls + 10-step summary buffer
- **Customizable Prompts**: Edit analysis objectives to focus on specific aspects
- **4-Phase Workflow**: Baseline Understanding → Pattern Discovery → Cross-Analysis → Validation & Synthesis
- **Multi-Dimensional Exploration**: Investigates feature interactions, segments, and complex patterns
- **Selective Visualization**: Creates only 5-7 essential charts (quality over quantity)
- **GPT-5 Powered**: Leverages advanced reasoning for comprehensive insights
- **Extended Analysis Time**: 180-second timeout supports thorough investigation (2-3 minutes)
- **Transparent**: Shows exact prompt being sent with character count

### 📊 Interactive Split-View Interface
- **Chat Panel (Left)**: Streaming conversation with the AI agent
- **Dataset Tabs (Right)**:
  - **Preview**: Scrollable data table with first 100 rows
  - **Schema**: Column metadata, types, and statistics
  - **SQL**: Query history with copy, re-run, and pin actions
  - **Charts**: Gallery of generated visualizations
  - **Report**: Generate and download markdown reports from pinned insights

### 🔍 Artifact Management
- **History Drawer**: Search and filter all queries, charts, and validations
- **Pin System**: Mark important findings for report generation
- **Timeline View**: Organized by chat turns for easy navigation

### 📝 Report Generation
- Automatically compiles pinned insights and charts into structured markdown
- Includes executive summary, key findings, visualizations, and methodology
- Downloadable for sharing and documentation

## Tech Stack

### Frontend
- **Next.js 15** with TypeScript and App Router
- **shadcn/ui** + Tailwind CSS for UI components
- **AI SDK 5** (`@ai-sdk/react` + `ai`) for streaming chat with multi-step tool calling
  - `useChat` hook with `DefaultChatTransport` for client-side streaming
  - `streamText` with `stepCountIs(10)` for autonomous multi-step workflows
  - `convertToModelMessages` and `toUIMessageStreamResponse` for message compatibility
  - Tool execution UI with AI Elements (collapsible tool calls, input/output display)
- **Vega-Lite** for data visualizations
- **Lucide React** for icons

### Backend
- **Supabase Postgres** for:
  - Metadata storage (`datasets`, `chat_turns`, `runs`, `reports` tables)
  - User authentication and RLS (Row Level Security)
  - Dynamic dataset table creation
- **Direct Postgres Connection** via `@neondatabase/serverless`:
  - Used for DDL operations (CREATE TABLE)
  - Optimized batch inserts with dynamic sizing
  - Transaction-wrapped ingestion for ACID compliance
- **OpenAI AI Models**:
  - GPT-4o for standard mode (fast, cost-effective analysis)
  - GPT-5 for deep dive mode (advanced reasoning, 40-step workflows)
- **Node.js Runtime** for API routes with SQL operations

### AI Tools (Server-Side)
The AI agent uses a minimal 2-tool system with reference-based data flow:

1. **`executeSQLQuery`**: Runs SELECT-only queries with automatic LIMIT enforcement
   - Executes SQL against dataset table
   - Stores full results in `runs.sample` (JSONB column)
   - Returns: `{ queryId, rowCount, preview, reasoning }`
   - Preview: First 5 rows only (token-efficient)
   - QueryId: Reference for fetching full data later

2. **`createChart`**: Generates Vega-Lite chart specifications
   - Accepts `queryId` parameter from executeSQLQuery
   - Fetches full data from `runs` table using queryId
   - Creates professional visualizations with proper styling
   - Supports: bar, line, scatter, area, pie charts

**Reference-Based Pattern**: Instead of passing large datasets through AI context, executeSQLQuery stores data in DB and returns a small preview + queryId. When visualization is needed, createChart fetches the full data using the queryId. This dramatically reduces token usage while maintaining full data access.

## AI Analysis Workflow

The AI agent operates autonomously through a 5-stage iterative workflow powered by multi-step tool calling:
- **Standard Mode**: `stepCountIs(10)` for quick, focused analysis (GPT-4o)
- **Deep Dive Mode**: `stepCountIs(40)` for exhaustive exploration - 30 tool calls + 10-step summary buffer (GPT-5)

### 1. **EXPLORE** - Execute SQL Queries
- Starts with broad queries to understand data distribution
- Uses aggregate functions (COUNT, SUM, AVG, GROUP BY) to reveal patterns
- Always applies LIMIT (≤100 rows) to avoid large result sets
- Examines preview (first 5 rows) before proceeding
- Example: `SELECT age, COUNT(*) as count FROM table GROUP BY age`

### 2. **VISUALIZE** - Create Charts (Judgment-Based)
- Generates visualizations when they add insight beyond numbers
- Uses queryId from executeSQLQuery to fetch full data
- Creates bar charts for distributions, line charts for trends, scatter for correlations
- Skips visualization for simple lookups or single aggregate values

### 3. **REFINE** - Iterative Drill-Down
The AI proactively investigates deeper without being asked:
- **Spike Detection**: When seeing outliers → queries that specific segment
- **Segment Analysis**: When one group stands out → breaks down further
- **Multi-Dimensional**: Explores age, job, education, marital status simultaneously
- **Pattern Testing**: Forms hypotheses and tests with targeted queries
- **Why? Chain**: Keeps asking "Why?" and "What else?" until patterns are clear
- Uses 5-8 tool calls for thorough exploration (not just 2-3 surface-level queries)

### 4. **VALIDATE** - Quality Assurance
- Verifies key claims with follow-up queries
- Cross-checks aggregations (do group totals = overall total?)
- Confirms specific percentages with focused queries
- Ensures visualizations support conclusions

### 5. **SUMMARIZE** - Actionable Insights
- Provides brief summary (2-3 sentences) of key findings
- References artifacts: "See SQL tab" or "Charts tab"
- Suggests natural next steps
- Focuses on WHAT is happening, WHY it's happening, WHAT should be done

### Self-Correction
- If query fails → analyzes error and retries with corrected approach
- If results empty → tries broader filters or different angle
- If unexpected → investigates with follow-up queries
- Never gives up after one failed attempt

### Example Flow
```
User: "What factors affect subscription rates?"

Step 1: executeSQLQuery → 11.7% baseline rate (45,211 records)
Step 2: executeSQLQuery by age → Age 18-25 shows 58% (SPIKE!)
        → createChart (bar chart)
Step 3: executeSQLQuery → Drill down: Students 18-25 have 72% rate
        → createChart (bar chart)
Step 4: executeSQLQuery → Verify finding: Confirmed 72.1%
Step 5: executeSQLQuery by marital → Singles 14.3% vs married 9.2%
        → createChart (bar chart)
Step 6: Summary: "Students aged 18-25 show 72% rate vs 11.7% baseline.
        Singles also elevated at 14.3%. See SQL and Charts tabs."
```

This demonstrates: baseline → exploration → spike detection → drill-down → verification → multi-dimensional → summary

## Deep Dive Mode

For complex datasets or when you need comprehensive insights, activate **Deep Dive Mode** for an exhaustive analysis using up to 40 steps (30 for exploration + 10 reserved for summary).

### How to Use Deep Dive

1. **Click "Deep Dive" button** in the chat header
2. **Review/Edit the analysis prompt** in the dialog:
   - Default: "Conduct a comprehensive analysis to identify actionable insights. Explore individual feature relationships with the target variable, multi-dimensional interactions between features, and key patterns or segments. Use exploratory analysis, visualization, statistical validation, and synthesis to deliver data-driven recommendations."
   - Customize to focus on specific features, business questions, or analytical approaches
3. **Click "Start Deep Dive"** to begin (analysis takes 2-3 minutes, powered by GPT-5)

### Deep Dive Workflow (40 Steps Total)

**Tool Budget:** 30 steps for SQL queries and visualizations
**Summary Buffer:** 10 steps reserved for generating comprehensive final summary

The agent follows a structured 4-phase approach:

**Phase 1: Baseline Understanding (Steps 1-5)**
- Establish overall statistics and distributions
- Profile categorical and numerical features
- Create foundational visualizations

**Phase 2: Pattern Discovery (Steps 6-15)**
- Explore feature-target relationships
- Identify correlations and associations
- Detect outliers, spikes, and anomalies
- Cross-tabulate multiple dimensions

**Phase 3: Deep Cross-Analysis (Steps 16-25)**
- Investigate feature interactions
- Discover hidden segments
- Validate patterns across subpopulations
- Explore temporal patterns if applicable

**Phase 4: Validation & Synthesis (Steps 26-40)**
- Verify all major claims (steps 26-28)
- Cross-check findings for consistency (steps 28-30)
- Identify top 3-5 actionable insights (step 30)
- Create 5-7 summary visualizations (selective, high-impact only)
- Generate comprehensive text summary (steps 31-40)
- Formulate concrete recommendations

### When to Use Deep Dive

✅ **Use Deep Dive when:**
- Initial dataset exploration (understand all dimensions)
- Complex business questions requiring multi-faceted analysis
- Looking for hidden patterns or feature interactions
- Need comprehensive analysis for stakeholder presentations
- Want to validate multiple hypotheses simultaneously

❌ **Use Standard Mode when:**
- Quick follow-up questions
- Focused single-dimension queries
- Verifying specific metrics or values
- Simple data lookups

### Example Deep Dive Customizations

**Focus on specific features:**
```
Analyze how age, job, and marital status interact to influence subscription rates.
Create visualizations comparing these segments.
```

**Business-oriented:**
```
Identify customer segments with highest conversion potential and provide specific
marketing recommendations backed by data.
```

**Statistical focus:**
```
Perform comprehensive correlation analysis between all numerical features and the
target variable. Identify and investigate non-linear relationships.
```

**Temporal analysis:**
```
Analyze subscription trends by month and day. Identify optimal contact timing patterns.
```

## Getting Started

### Prerequisites
- Node.js 18+
- pnpm package manager
- Supabase account with Postgres database
- OpenAI API key

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yourusername/data-analyst-agent.git
   cd data-analyst-agent
   ```

2. **Install dependencies:**
   ```bash
   pnpm install
   ```

3. **Set up environment variables:**

   Copy the example env file:
   ```bash
   cp .env.example .env.local
   ```

   Add your credentials to `.env.local`:

   **Required variables:**
   - `OPENAI_API_KEY` - Get from [OpenAI dashboard](https://platform.openai.com/api-keys)
   - `SUPABASE_POSTGRES_URL_NON_POOLING` - From Supabase project settings → Database → Connection string (Direct connection)
   - `SUPABASE_POSTGRES_URL` - From Supabase project settings → Database → Connection string (Session pooling)
   - `NEXT_PUBLIC_SUPABASE_URL` - From Supabase project settings → API → Project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` - From Supabase project settings → API → Project API keys (anon/public)
   - `SUPABASE_SERVICE_ROLE_KEY` - From Supabase project settings → API → Project API keys (service_role)

   Example `.env.local`:
   ```bash
   # OpenAI API
   OPENAI_API_KEY=sk-proj-...

   # Supabase (Direct Postgres Connection)
   SUPABASE_POSTGRES_URL_NON_POOLING="postgres://postgres.[ref]:password@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=require"
   SUPABASE_POSTGRES_URL="postgres://postgres.[ref]:password@aws-0-region.pooler.supabase.com:6543/postgres?sslmode=require"

   # Supabase (Client Authentication)
   NEXT_PUBLIC_SUPABASE_URL="https://[ref].supabase.co"
   NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
   SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
   ```

4. **Initialize the database:**

   **For first-time setup:**
   - Open your Supabase project → SQL Editor
   - Run `scripts/002_initialize_database.sql`
   - This creates all necessary tables (`datasets`, `chat_turns`, `runs`, `reports`) and indexes

   **If you need to reset an existing database:**
   > ⚠️ **WARNING**: This will delete all data!
   - First run: `scripts/000_reset_database.sql`
   - Then run: `scripts/002_initialize_database.sql`

   > **Note**: The database schema includes `table_name`, `column_count`, and `user_context` fields. If you ran an older schema version, you must reset your database using the scripts above.

5. **Run the development server:**
   ```bash
   pnpm dev
   ```

6. **Open your browser:**
   Navigate to [http://localhost:3000](http://localhost:3000)

## Usage

### 1. Upload Your Data
- Navigate to the home page
- Optionally provide context about your data in the textarea
- Upload a CSV file (≤20MB, ≤200 columns)
- The system creates a Postgres table and infers column types

### 2. Analyze with AI
- Ask questions in natural language
- The AI automatically:
  - Runs SQL queries to explore your data
  - Generates relevant visualizations
  - Validates findings
  - Provides concise insights
- Switch to **Deep Dive mode** for exhaustive analysis (up to 40 steps):
  - Click "Deep Dive" button in chat header
  - Customize the analysis prompt if needed
  - Get comprehensive insights with 5-7 high-impact visualizations
  - Powered by GPT-5 for advanced reasoning

### 3. Review Artifacts
- **Preview Tab**: Browse your raw data
- **Schema Tab**: Understand column types and statistics
- **SQL Tab**: Review all executed queries
- **Charts Tab**: View generated visualizations
- **History Drawer**: Search and filter all artifacts

### 4. Generate Reports
- Pin important insights and charts
- Click "Generate Report" in the Report tab
- Edit the report inline if needed
- Download as markdown for sharing

## Architecture

### CSV Ingestion Pipeline

The application uses an optimized batch ingestion system with enterprise-grade reliability:

1. **File Validation**:
   - Size limit: 20MB maximum
   - Column limit: 200 columns maximum
   - Multi-delimiter support: comma, semicolon, tab

2. **Type Inference**:
   - Samples first 100 rows to infer column types
   - Supports: INTEGER, DOUBLE PRECISION, BOOLEAN, TIMESTAMPTZ, TEXT
   - Smart type detection with fallback to TEXT

3. **Dynamic Batch Insertion**:
   - **Parameter limit safety**: Calculates batch size as `floor(60000 / column_count)` to prevent PostgreSQL's 65,535 parameter limit
   - **Transaction wrapping**: All inserts wrapped in BEGIN/COMMIT for ACID compliance
   - **Automatic rollback**: On any error, rolls back all changes and cleans up metadata
   - **Progress logging**: Detailed batch-by-batch progress (e.g., "Inserted batch 5/12")

4. **Error Handling**:
   - Failed inserts trigger automatic rollback
   - Orphaned dataset records are cleaned up
   - Detailed error messages returned to client

**Example**: A CSV with 150 columns will use batch size of 400 rows (60,000 ÷ 150 = 400), while a CSV with 10 columns will use the maximum batch size of 1,000 rows.

### Data Flow (Reference-Based Pattern)
1. **CSV Upload** → Parsed and inserted into Postgres table `ds_<datasetId>` using optimized batch pipeline
2. **User Question** → AI agent initiates autonomous 5-stage workflow
3. **Tool Execution Loop**:
   - **Standard mode** (GPT-4o): `stepCountIs(10)` for focused analysis
   - **Deep dive mode** (GPT-5): `stepCountIs(40)` with 30+10 buffer strategy:
     - Steps 1-30: SQL exploration and selective visualization (5-7 charts)
     - Steps 31-40: Reserved for comprehensive text summary generation
     - This buffer ensures final summary is always generated even if tool calls run long
   - **executeSQLQuery**:
     - Executes SELECT query against dataset table
     - Stores full results in `runs.sample` (JSONB)
     - Returns to AI: `{ queryId, rowCount, preview }` (only 5 rows)
     - On error: Returns helpful message with fix suggestions (e.g., lists available columns)
   - **createChart** (selective, judgment-based):
     - Receives queryId from executeSQLQuery
     - Fetches full data from `runs` table using queryId
     - Generates Vega-Lite spec and stores in `runs.chart_spec`
     - Only created for high-impact insights (5-7 per deep dive)
   - AI examines preview, decides next action (drill-down, verify, visualize, etc.)
   - Loop continues until analysis is complete or step limit reached
4. **Streaming Response** → Results streamed to client via `toUIMessageStreamResponse()`
5. **Artifact Storage** → All queries and charts saved to `runs` table for history

**Token Efficiency**: By storing full datasets in the database and only passing 5-row previews through AI context, the system maintains full data access while dramatically reducing token consumption. The queryId reference pattern eliminates redundant data transfer between tools.

### SQL Best Practices (PostgreSQL Dialect)

The AI agent follows these PostgreSQL-specific patterns to avoid common errors:

1. **CTE Pattern for Derived Fields**: When using CASE expressions or derived columns, compute them in a CTE named `base`, then SELECT from `base` and GROUP BY the alias names
   ```sql
   WITH base AS (
     SELECT CASE WHEN age < 25 THEN 'young' ELSE 'old' END AS age_group
     FROM table
   )
   SELECT age_group, COUNT(*) FROM base GROUP BY age_group
   ```

2. **Ordinal Grouping**: Prefer `GROUP BY 1,2,3` (matching SELECT order) over repeating column names

3. **Postgres Operators**: Use `||` for string concatenation, `COALESCE()`, `DATE_TRUNC()`, `FILTER (WHERE ...)` for conditional aggregates

4. **Always LIMIT, No Semicolons**: Every query ends with `LIMIT ≤1500` with no trailing semicolons

### Database Schema
- `datasets`: Metadata about uploaded CSV files
- `chat_turns`: Conversation history
- `runs`: Unified artifacts (SQL queries, charts, validations)
- `reports`: Generated markdown reports
- `ds_<datasetId>`: Dynamic tables for each uploaded dataset

### Security
- **SQL Safety**: SELECT-only queries with automatic LIMIT (≤1500 rows), no semicolons allowed
- **Error Recovery**: Helpful error messages with fix suggestions (e.g., lists available columns on column-not-found errors)
- **Timeout Protection**: 5-second query timeout
- **Input Validation**: CSV size and column limits enforced
- **Session-Based**: Datasets deleted on browser close

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
│       ├── sql/route.ts                    # SQL execution endpoint
│       ├── runs/
│       │   ├── route.ts                    # Artifact management
│       │   └── [id]/pin/route.ts           # Pin/unpin artifacts
│       └── report/generate/route.ts        # Report generation
├── components/
│   ├── chat-panel.tsx              # Chat interface with AI SDK
│   ├── dataset-tabs.tsx            # Tabbed dataset viewer
│   ├── history-drawer.tsx          # Artifact search and filter
│   ├── theme-provider.tsx          # Theme context provider
│   ├── vega-lite-chart.tsx         # Vega-Lite visualization wrapper
│   ├── ai-elements/                # AI-powered UI components
│   │   ├── actions.tsx             # Tool action buttons
│   │   ├── artifact.tsx            # Artifact display
│   │   ├── branch.tsx              # Message branching
│   │   ├── chain-of-thought.tsx    # Reasoning display
│   │   ├── code-block.tsx          # Code syntax highlighting
│   │   ├── context.tsx             # Context display
│   │   ├── conversation.tsx        # Conversation view
│   │   ├── image.tsx               # Image rendering
│   │   ├── inline-citation.tsx     # Inline citations
│   │   ├── loader.tsx              # Loading states
│   │   ├── message.tsx             # Message component
│   │   ├── open-in-chat.tsx        # Open artifact in chat
│   │   ├── prompt-input.tsx        # Chat input
│   │   ├── reasoning.tsx           # AI reasoning display
│   │   ├── response.tsx            # Response component
│   │   ├── sources.tsx             # Source attribution
│   │   ├── suggestion.tsx          # Suggestion chips
│   │   ├── task.tsx                # Task display
│   │   ├── tool.tsx                # Tool call display
│   │   └── web-preview.tsx         # Web preview
│   ├── tabs/
│   │   ├── charts-tab.tsx          # Visualization gallery
│   │   ├── preview-tab.tsx         # Data preview table
│   │   ├── report-tab.tsx          # Report generation UI
│   │   ├── schema-tab.tsx          # Schema browser
│   │   └── sql-tab.tsx             # Query history
│   └── ui/                         # shadcn/ui component library
│       ├── avatar.tsx
│       ├── badge.tsx
│       ├── button.tsx
│       ├── card.tsx
│       ├── carousel.tsx
│       ├── collapsible.tsx
│       ├── dialog.tsx
│       ├── dropdown-menu.tsx
│       ├── hover-card.tsx
│       ├── input.tsx
│       ├── label.tsx
│       ├── progress.tsx
│       ├── resizable.tsx
│       ├── scroll-area.tsx
│       ├── select.tsx
│       ├── sheet.tsx
│       ├── table.tsx
│       ├── tabs.tsx
│       ├── textarea.tsx
│       └── tooltip.tsx
├── lib/
│   ├── postgres.ts                 # Direct Postgres connection
│   ├── session-cleanup.ts          # Session management utilities
│   ├── sql-guard.ts                # SQL safety validation
│   ├── types.ts                    # TypeScript definitions
│   ├── utils.ts                    # Utility functions
│   └── supabase/
│       ├── client.ts               # Supabase client (browser)
│       └── server.ts               # Supabase client (server)
├── scripts/
│   ├── 000_reset_database.sql      # Database reset script
│   ├── 001_create_schema.sql       # Schema creation
│   └── 002_initialize_database.sql # Database initialization
├── styles/
│   └── globals.css                 # Global stylesheet
├── public/
│   ├── placeholder-logo.png
│   ├── placeholder-logo.svg
│   ├── placeholder-user.jpg
│   ├── placeholder.jpg
│   └── placeholder.svg
├── components.json                 # shadcn/ui configuration
├── next.config.mjs                 # Next.js configuration
├── postcss.config.mjs              # PostCSS configuration
├── tsconfig.json                   # TypeScript configuration
├── package.json                    # Dependencies
├── pnpm-lock.yaml                  # Lock file
└── README.md                       # This file
```

## Deployment

This project is configured for deployment on Vercel:

1. Push your code to GitHub
2. Import the repository in Vercel
3. Add environment variables in Vercel project settings
4. Deploy

**Live Demo**: [https://vercel.com/kaihon333haha-5908s-projects/v0-data-analyst-agent](https://vercel.com/kaihon333haha-5908s-projects/v0-data-analyst-agent)

## Development

Continue building on [v0.app](https://v0.app/chat/projects/WdUJaFsY9r0) - changes sync automatically to this repository.

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.
