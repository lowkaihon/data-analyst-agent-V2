# Data Analyst Agent

An AI-powered data analysis platform that enables interactive exploration of CSV datasets through natural conversation. Upload your data, ask questions, and let the AI autonomously run SQL queries, generate visualizations, and produce comprehensive reports.

[![Deployed on Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-black?style=for-the-badge&logo=vercel)](https://vercel.com/kaihon333haha-5908s-projects/v0-data-analyst-agent)
[![Built with v0](https://img.shields.io/badge/Built%20with-v0.app-black?style=for-the-badge)](https://v0.app/chat/projects/WdUJaFsY9r0)

Scaffolded with Vercel v0; productionized with Next.js 16 + Supabase/Postgres. Used AI pair-programming (Claude Code) to accelerate refactors.

## Features

### 🤖 AI-Powered Analysis

#### Technical Specifications

| Component | Configuration | Details |
|-----------|--------------|---------|
| **Normal Mode** | GPT-4o | 10 steps max, 1-3 queries typical, judgment-based charts |
| **Deep Dive Mode** | GPT-5-mini (reasoningEffort: 'medium') | 50 steps max (system buffer), 20-30 SQL queries expected, 5-7 visualizations, 4-5 minute duration |
| **SQL Sub-Agent** | GPT-4o-mini | Analyzes full query results (up to 100 rows), cost-effective |
| **Report Generation** | GPT-5 | High-quality synthesis from pinned artifacts |

- **Multi-Model Architecture**: Uses GPT-4o for normal mode and GPT-5-mini (reasoningEffort: 'medium') for deep dive mode. Uses GPT-4o-mini for SQL subagent (fast, cost-effective analysis of full query results). Uses GPT-5 for report generation.
- **Dual-Mode Architecture**: Normal mode (focused Q&A with scope discipline) + Deep dive mode (agentic reasoning for comprehensive exploration)
- **Multi-Step Tool Calling**: See [Technical Specifications](#technical-specifications) table above for query depths and step limits
- **Focused Answers**: Normal mode answers exactly what's asked without unsolicited exploration. Deep dive mode proactively investigates spikes, outliers, and patterns
- **Smart Visualizations**: Normal mode creates charts when data shows patterns. Deep dive generates 5-7 high-impact charts for key distributions
- **Self-Correction**: Retries failed queries with helpful error messages and fix suggestions
- **Token-Efficient Architecture**: Reference-based data flow minimizes token usage while maintaining full data access
- **Contextual Insights**: Understands dataset context and suggests follow-up questions for further exploration

### 🔒 Privacy & Data Protection
- **Automatic Cleanup**: All uploaded datasets deleted after 24 hours (Vercel Cron every 6 hours)
- **Session Isolation**: Complete user isolation via Row Level Security (RLS)
- **No Persistent Storage**: Data never stored permanently - automatic cleanup enforced
- **Anonymous Authentication**: Privacy without requiring user accounts
- **Rate Limiting**: 5 uploads per hour per user (session-based, PostgreSQL tracking)
- **Storage Quota**: Maximum 10 datasets per user to prevent resource exhaustion

### 📊 Interactive Split-View Interface
- **Chat Panel (Left)**: Streaming conversation with the AI agent
- **Data Explorer Tabs (Right)**:
  - **Preview**: Scrollable data table with first 100 rows (user-facing view)
  - **Schema**: Column metadata, types, and statistics
  - **SQL**: Query history with copy, re-run, and pin actions
  - **Charts**: Gallery of generated visualizations
  - **Report**: Generate and download markdown reports from pinned insights

### 🔍 Artifact Management
- **History Drawer (in development)**: Search and filter all queries, charts, and validations
- **Pin System**: Mark important findings for report generation
- **Timeline View (in development)**: Organized by chat turns for easy navigation

### 📝 Report Generation

Generate comprehensive business intelligence reports powered by GPT-5 using data from your analysis artifacts.

**Data Sources (up to 50 items total):**
- **Pinned runs**: All pinned queries and charts are guaranteed inclusion (added first)
- **Recent runs**: Recent successful runs fill remaining slots up to 50 total
- **Smart prioritization**: Pin important insights to ensure they appear in the report

**What's included from each artifact:**
- **SQL queries**: Query text, reasoning, 5-row sample preview, and AI analysis summary
  - *Token efficiency*: Only 5 rows shown per query, but includes AI analysis text generated from full results (up to 100 rows analyzed by sub-agent)
- **Charts**: Numbered catalog with titles (e.g., "Chart 3: Revenue Trend Over Time") for easy reference
- **Insights**: One-sentence findings from each analysis step
- **AI summaries**: Full analysis text from chat responses (especially valuable from deep-dive mode)

**Report structure:**
- **Executive Summary**: 3-5 actionable insights that decision-makers can act on immediately
- **Key Findings**: Discoveries with specific data, concrete numbers, and evidence
- **Actionable Recommendations**: Structured recommendations with priority levels, expected impact, and success metrics
- **Methodology & Limitations**: Analysis approach, data quality issues, and assumptions

**Export**: Download as markdown for sharing with stakeholders or documentation

## Tech Stack

### Frontend
- **Next.js 16** with TypeScript and App Router
- **shadcn/ui** + Tailwind CSS for UI components
- **AI SDK 5** (`@ai-sdk/react` + `ai`) for streaming chat with multi-step tool calling
  - `useChat` hook with `DefaultChatTransport` for client-side streaming
  - `streamText` with `stepCountIs(10)` for autonomous multi-step workflows
  - `convertToModelMessages` and `toUIMessageStreamResponse` for message compatibility
  - Tool execution UI with AI Elements (collapsible tool calls, input/output display)
- **Performance optimizations**: React.memo, useMemo, lazy rendering, and non-blocking effects for smooth deep dive sessions
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
- **OpenAI AI Models**: See [Technical Specifications](#technical-specifications) for model assignments, step counts, and query depths
- **Node.js Runtime** for API routes with SQL operations

### AI Tools (Server-Side)
The AI agent uses a minimal 2-tool system with reference-based data flow:

**Architecture**: Tools are implemented using factory functions (`createSQLQueryTool`, `createChartTool`) that inject runtime context (dataset, user, database pool) at request time. This enables clean separation: `route.ts` handles HTTP requests (170 lines), while tools in `lib/ai-tools/` handle business logic (424 lines total). See [Project Structure](#project-structure) for file organization.

1. **`executeSQLQuery`**: Runs SELECT-only queries with automatic LIMIT enforcement
   - Executes SQL against dataset table
   - Stores full results in `runs.sample` (JSONB column)
   - Spawns GPT-4o-mini sub-agent to analyze full results (up to 100 rows)
   - Returns: `{ queryId, rowCount, columns, preview, analysis, reasoning }`
   - Columns: Array of field names from query results (use these exact names in createChart - may differ from original table due to aliases/calculated fields)
   - Preview: First 5 rows only (token-efficient)
   - Analysis: 2-3 sentence summary from sub-agent covering patterns, outliers, and suggested next dimensions
   - QueryId: Reference for fetching full data later

2. **`createChart`**: Generates Vega-Lite chart specifications with intelligent data fetching
   - Accepts `queryId` parameter from executeSQLQuery
   - Smart data handling based on dataset size and chart type:
     • **Boxplots**: Auto-aggregates for datasets >10K rows using SQL PERCENTILE_CONT() for accurate quartiles/outliers
     • **Scatter/line/area**: Limited to 5K rows - returns error with aggregation guidance if exceeded
     • **Bar/pie/heatmap**: Limited to 1.5K rows - typically used with pre-aggregated data
   - Creates professional visualizations with accessibility features
   - Supports: bar, line, scatter, boxplot, area, pie, heatmap charts
   - Chart selection guidance based on data types:
     • Categorical X + Quantitative Y → bar (aggregated) or boxplot (raw distribution)
     • Quantitative X + Quantitative Y → scatter
     • Temporal X + Quantitative Y → line or area
     • Categorical X + Categorical Y + Quantitative Z → heatmap (2D patterns, bivariate analysis)
   - Data volume best practices:
     • Large scatter/line datasets: Aggregate via SQL (binning, downsampling, coarser time granularity)
     • Boxplots: Automatically handled via server-side statistical aggregation
     • Heatmaps: Use aggregated data (GROUP BY x, y). Limit to ≤30 categories per dimension for readability
   - **Field Validation**: createChart validates that xField, yField, and colorField exist in the query results. If a field name doesn't match, the system uses fuzzy matching (Levenshtein distance) to suggest the closest available column name with "Did you mean...?" suggestions for typos.

**Reference-Based Pattern**: Instead of passing large datasets through AI context, executeSQLQuery stores data (up to 1,500 rows) in DB and returns a small preview + queryId + original SQL. When visualization is needed, createChart re-executes the SQL intelligently:
- For datasets ≤chart limit: Fetches full data (1.5K-10K rows depending on chart type)
- For boxplots >10K rows: Automatically uses SQL aggregates (PERCENTILE_CONT) for accurate distribution statistics
- For other charts exceeding limits: Returns error with guidance to aggregate data in SQL

**Sequential Execution Required**: createChart must be called AFTER executeSQLQuery completes successfully. Never call both tools in parallel - the queryId must be obtained from executeSQLQuery's response before calling createChart.

This dramatically reduces token usage while maintaining accurate visualizations for any dataset size.

## Performance Optimizations

The application implements React-specific optimizations to ensure smooth interactions during intensive deep dive analysis sessions:

### Component-Level Optimizations
- **React.memo on Message and Tool components**: Prevents unnecessary re-renders across the 30-40 tool calls in deep dive mode
- **Memoized JSON operations**: Uses `useMemo` for expensive `JSON.stringify` operations on large datasets (up to 1,500 rows)
- **Lazy rendering for collapsed tools**: Tool content only renders when expanded, avoiding unnecessary JSON stringification and syntax highlighting

### Rendering Optimizations
- **Single syntax highlighter**: Conditionally renders one `SyntaxHighlighter` instance based on theme instead of dual light/dark instances
- **Non-blocking scroll**: Uses `useEffect` instead of `useLayoutEffect` for auto-scroll to prevent render blocking during streaming

### Impact
These optimizations reduce CPU time by 60-80% during deep dive sessions with 40 tool calls, maintaining responsive interactions as conversation history grows.

## AI Modes

### Normal Mode (GPT-4o, 10 steps)

Normal mode is engineered for focused Q&A with strict scope discipline. It answers your specific question efficiently and stops.

**Core Principles:**
- **Scope Discipline**: Responds only to the specific question asked
- **Minimum Queries**: Uses the minimum SQL queries required to answer completely
- **No Proactive Exploration**: Does not explore adjacent topics, validate with additional queries, or perform comprehensive analysis unless explicitly requested
- **Direct Answers**: States answer with supporting evidence and stops

**Typical Workflow:**
1. Parse the user's specific question
2. Execute necessary SQL queries (usually 1-3)
3. Create visualizations if data shows clear patterns (5+ rows)
4. State direct answer with evidence
5. Suggest 2 follow-up questions
6. Stop and wait for next question

**Example:**
```
User: "What is the average age by job type?"

Step 1: executeSQLQuery → Calculates average age for each job type
Step 2: createChart → Bar chart showing the distribution
Step 3: Response → "Average age varies from 32 (blue-collar) to 47 (retired).
        See SQL and Charts tabs for details."

Suggested follow-ups:
1. How does age correlate with subscription rate?
2. What is the income distribution by job type?
```

**When to use Normal Mode:**
- Quick, specific questions
- Single-dimension queries
- Verifying specific metrics or values
- Simple data lookups
- Follow-up questions on existing analysis

For exploratory analysis or comprehensive investigations, use Deep Dive mode instead.

### Deep Dive Mode (GPT-5-mini, 50 steps max)

For complex datasets or when you need comprehensive insights, activate **Deep Dive Mode** for an exhaustive analysis.

**How to Use Deep Dive:**

1. **Click "Deep Dive" button** in the chat header
2. **Review/Edit the analysis prompt** in the dialog:
   - Default: "Conduct a comprehensive analysis to identify actionable insights. Explore individual feature relationships with the target variable, multi-dimensional interactions between features, and key patterns or segments. Use exploratory analysis, visualization, statistical validation, and synthesis to deliver data-driven recommendations."
   - Customize to focus on specific features, business questions, or analytical approaches
3. **Click "Start Deep Dive"** to begin (analysis takes 4-5 minutes, powered by GPT-5-mini with reasoningEffort: 'medium')

**Deep Dive Workflow (AI Budget: 50 Steps, Adaptive based on dataset complexity)**

**System allows:** 50 steps total with comfortable buffer
**Expected exploration:** 20-30 SQL queries + 5-7 visualizations (28-42 tool calls)
**Adaptive scope:** Query depth adjusts based on column count (≤10, 11-20, 21-30 columns)

Deep dive mode trusts GPT-5-mini's agentic reasoning capabilities to autonomously determine the best exploration approach. Unlike normal mode's focused Q&A, deep dive operates with minimal restrictions:

**What the AI is told:**
- Perform thorough analysis of the entire dataset
- Explore major dimensions, patterns, outliers, and feature interactions
- Validate key findings
- Deliver 3-5 actionable insights with strong evidence
- Expected exploration depth: 20-30 SQL queries covering dimensions, interactions, cross-validations, and hypothesis testing
- Typically generates 5-7 high-impact visualizations
- Adaptive requirements based on dataset size (small/medium/wide)

**How it works:**
The AI autonomously decides what to explore based on the data and user's objectives. It may:
- Start with broad queries to understand distributions
- Drill down into interesting patterns or outliers
- Cross-analyze multiple dimensions
- Validate hypotheses with targeted queries
- Create visualizations for key findings

**Output structure:**
Responses are formatted with two sections:
1. **Executive Summary**: 3-5 key insights (max 10 sentences) with evidence inline
2. **Detailed Analysis**: Key findings, validation performed, hypothesis tests, standout segments, and limitations

The agentic approach allows GPT-5-mini to adapt its exploration strategy to each unique dataset and question, rather than following a rigid workflow.

**Performance Note**: The UI implements React.memo, lazy rendering, and memoized operations to maintain smooth interactions during comprehensive analysis sessions. Tool calls render efficiently even with 50+ steps in the conversation history.

**When to Use Each Mode:**

✅ **Use Deep Dive when:**
- Initial dataset exploration (understand all dimensions)
- Complex business questions requiring multi-faceted analysis
- Looking for hidden patterns or feature interactions
- Need comprehensive analysis for stakeholder presentations
- Want to validate multiple hypotheses simultaneously

✅ **Use Normal Mode when:**
- Quick follow-up questions
- Focused single-dimension queries
- Verifying specific metrics or values
- Simple data lookups

### How Context Works Between Modes

Understanding how conversation history and data artifacts are managed across modes is essential for effective analysis.

#### Conversation History Behavior

**Deep Dive Mode** starts with **fresh conversation context** every time:
- When you enter deep dive mode, the AI only sees your current deep dive request + dataset schema
- Previous chat history is not available to the AI during deep dive analysis
- This ensures unbiased, comprehensive exploration without assumptions from prior exchanges
- **Sequential deep dives don't see each other** - each starts fresh

**Normal Mode** maintains **full cumulative conversation history**:
- Sees all previous questions, answers, and exchanges (including deep dive interactions)
- Can reference findings from previous deep dives
- Provides continuity for follow-up questions and iterative exploration

**Scenario Examples:**

| Scenario | What AI Sees |
|----------|-------------|
| **Normal Mode Question** | ✅ Full conversation history |
| **Enter Deep Dive** | ❌ Only current request + schema (history reset) |
| **Return to Normal Mode** | ✅ Full history including the deep dive interaction |
| **Second Deep Dive** | ❌ Only current request + schema (does NOT see first deep dive) |

**Customizing Deep Dive Context:**

Since deep dive starts fresh, you can **edit the deep dive prompt** to include specific context:

```
Example: "Building on Query 15 which showed high churn in the West region,
perform comprehensive analysis of customer segments and churn drivers in
that region. Focus on age, job type, and account tenure interactions."
```

This allows you to provide targeted direction while still benefiting from deep dive's comprehensive approach.

#### Shared Artifacts & Data

**All analysis artifacts persist across both modes and are accessible to you:**

✅ **SQL queries** - View in SQL tab, copy, re-run, or pin
✅ **Charts and visualizations** - Browse in Charts tab
✅ **Query results** - Stored in database for chart generation
✅ **AI analysis summaries** - Preserved for report generation
✅ **Pinned insights** - Flagged items persist across sessions

**Example Workflow:**

```
1. Normal Mode: "What is average revenue by region?"
   → Query 1 created, Chart 1 generated
   → Response: "West: $2.5M, East: $1.8M, South: $1.2M"

2. Deep Dive: "Analyze regional performance comprehensively"
   → Starts fresh (doesn't see Query 1 conversation)
   → Creates Query 2-26, Chart 2-7 independently
   → Comprehensive analysis of all regions
   → All artifacts saved to database

3. Normal Mode: "Based on the deep dive, why did East decline?"
   → AI sees full conversation history (including deep dive Q&A)
   → Can reference: "The deep dive analysis identified..."
   → Access to ALL artifacts (Query 1-26, Chart 1-7) in tabs
```

**Report Generation** uses artifacts from both modes:
- Pulls from pinned and recent SQL queries/charts regardless of mode
- Includes AI analysis summaries from both normal and deep dive interactions
- Up to 50 artifacts can be included in reports

**Important Limitations:**

⚠️ **Session-Based Only**: Context only persists within a single chat session. If you refresh the page, close the browser, or start analyzing a new dataset, the conversation history resets.

**To preserve findings:**
- Use the **"Generate Report"** button to compile all insights into a downloadable markdown report
- **Pin important artifacts** (queries/charts) before generating reports
- Reports include references to up to 50 pinned/recent artifacts

⚠️ **Token Limits**: After extensive analysis (especially multiple deep dives), the conversation history can approach model context limits (~100K-200K tokens).

**When approaching limits:**
- Generate a report to summarize current findings
- Start a new chat session for orthogonal analysis directions
- Focus on pinned artifacts to preserve the most important visualizations

**Example Deep Dive Customizations:**

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
   git clone https://github.com/lowkaihon/data-analyst-agent-V2.git
   cd data-analyst-agent-V2
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

   # Optional: Cron Endpoint Security (recommended for production)
   # CRON_SECRET="your-secret-token-here"
   ```

   **Optional Environment Variables:**
   - `CRON_SECRET` - Bearer token for additional cron endpoint protection (recommended for production)
     - Generate with: `openssl rand -base64 32`
     - If set, you must uncomment lines 9-14 in `/api/datasets/cleanup/route.ts` to enable verification
     - Note: Currently commented out by default; cron endpoint relies on Vercel Cron user-agent verification

4. **Initialize the database:**

   **For first-time setup:**
   - Open your Supabase project → SQL Editor
   - Run `scripts/initialize_database.sql`
   - This creates all necessary tables (`datasets`, `chat_turns`, `runs`, `reports`) and indexes

   **If you need to reset an existing database:**
   > ⚠️ **WARNING**: This will delete all data!
   - First run: `scripts/reset_database.sql`
   - Then run: `scripts/initialize_database.sql`

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
- Upload a CSV file (≤20MB, ≤30 columns)
- The system creates a Postgres table and infers column types
- **Privacy Note**: Your data is automatically deleted after 24 hours

### 2. Analyze with AI
- Ask questions in natural language
- The AI automatically:
  - Runs SQL queries to analyze your data
  - Generates relevant visualizations
  - Provides concise insights
- Switch to **Deep Dive mode** for exhaustive analysis (50-step system max, 4-5 minutes):
  - Click "Deep Dive" button in chat header
  - Customize the analysis prompt if needed
  - Get comprehensive insights (see [Technical Specifications](#technical-specifications))

### 3. Review Artifacts
- **Preview Tab**: Browse your raw data
- **Schema Tab**: Understand column types and statistics
- **SQL Tab**: Review all executed queries
- **Charts Tab**: View generated visualizations
- **History Drawer (in development)**: Search and filter all artifacts

### 4. Generate Reports
- Pin important insights and charts
- Click "Generate Report" in the Report tab
- Edit the report inline if needed
- Download as markdown for sharing

## Architecture

### CSV Ingestion Pipeline

The application uses an optimized batch ingestion system with enterprise-grade reliability and security:

1. **File Validation & Security**:
   - MIME type validation (text/csv, text/plain only)
   - File extension validation (.csv only)
   - Size limit: 20MB maximum
   - Empty file rejection
   - Column limit: 30 columns maximum
   - Multi-delimiter support: comma, semicolon, tab

2. **Column Name Sanitization**:
   - Strips special characters to prevent SQL injection
   - Limits to 63 characters (PostgreSQL column name limit)
   - Replaces unsafe characters with underscores

3. **Formula Injection Protection**:
   - Sanitizes CSV cell values to prevent spreadsheet formula injection attacks
   - Detects dangerous formula prefixes: `=`, `+`, `@`, `|`, `\t` (tab), `\r` (carriage return)
   - Smart handling for `-`: Allows negative numbers (e.g., `-123`, `-5.5`) but blocks formula patterns (e.g., `-@SUM()`, `-command`)
   - Automatically prefixes with single quote to neutralize formulas
   - Applied to all string values during ingestion

4. **Type Inference**:
   - Samples first 100 rows to infer column types
   - Supports: INTEGER, DOUBLE PRECISION, BOOLEAN, TIMESTAMPTZ, TEXT
   - Smart type detection with fallback to TEXT

5. **Dynamic Batch Insertion**:
   - **Parameter limit safety**: Calculates batch size as `floor(60000 / column_count)` to prevent PostgreSQL's 65,535 parameter limit
   - **Transaction wrapping**: All inserts wrapped in BEGIN/COMMIT for ACID compliance
   - **Automatic rollback**: On any error, rolls back all changes and cleans up metadata
   - **Progress logging**: Detailed batch-by-batch progress (e.g., "Inserted batch 5/12")

6. **Error Handling**:
   - Failed inserts trigger automatic rollback
   - Orphaned dataset records are cleaned up
   - Detailed error messages returned to client

**Example**: A CSV with 150 columns will use batch size of 400 rows (60,000 ÷ 150 = 400), while a CSV with 10 columns will use the maximum batch size of 1,000 rows.

### Data Flow (Reference-Based Pattern)
1. **CSV Upload** → Parsed and inserted into Postgres table `ds_<datasetId>` using optimized batch pipeline
2. **User Question** → AI agent processes user questions using appropriate mode strategy
3. **Tool Execution Loop** (see [Technical Specifications](#technical-specifications) for model assignments and step counts):
   - **Normal mode** (GPT-4o): `stepCountIs(10)` for focused analysis
   - **Deep dive mode** (GPT-5-mini with reasoningEffort: 'medium'): `stepCountIs(50)` with adaptive scope based on column count
   - **Tools** (detailed specifications in [AI Tools](#ai-tools-server-side) section):
     - **executeSQLQuery**: Executes queries, stores full results in DB, returns 5-row preview + queryId + AI analysis
     - **createChart**: Generates Vega-Lite visualizations using queryId reference with intelligent data fetching
   - **Chart usage patterns**:
     - Normal mode: Creates charts when data shows clear patterns (judgment-based)
     - Deep dive mode: Creates 5-7 high-impact charts for key distributions and insights
   - **Normal mode**: AI answers question directly with evidence and stops
   - **Deep dive mode**: AI decides next action based on patterns discovered (drill-down, cross-analyze, visualize, etc.)
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

4. **Always LIMIT, No Semicolons**: Every query ends with `LIMIT ≤1500` for analysis (visualization queries use smart data handling: fetch up to 10K rows for small datasets, auto-aggregate for large boxplots, or reject with guidance for other large charts) with no trailing semicolons

### Database Schema
- `datasets`: Metadata about uploaded CSV files
- `chat_turns`: Conversation history
- `runs`: Unified artifacts (SQL queries, charts, validations)
- `reports`: Generated markdown reports
- `rate_limits`: Rate limiting tracking (user_id, endpoint, request_count, window_start)
- `ds_<datasetId>`: Dynamic tables for each uploaded dataset

### Security

The application implements multiple layers of security to protect against common vulnerabilities:

#### Authentication & Authorization
- **Anonymous Authentication**: Automatic session-based user isolation with Row Level Security (RLS)
  - Each browser session gets a unique anonymous user ID
  - Users can only see their own datasets - complete session isolation
  - No login required - seamless user experience
  - Sessions persist across page refreshes
  - Automatic session refresh prevents unexpected expiration
  - See [RLS_IMPLEMENTATION.md](./RLS_IMPLEMENTATION.md) for implementation details

#### SQL Injection Prevention
- **Table Name Validation**: Only allows `ds_<uuid_with_underscores>` format for dynamic tables (e.g., `ds_550e8400_e29b_41d4_a716_446655440000`)
- **Column Name Sanitization**: Strips special characters from CSV column names
- **Parameterized Queries**: All database queries use parameterized statements
- **SQL Guard with Pattern Detection**:
  - SELECT-only queries enforced
  - Blocks SQL comments (`--`, `/* */`)
  - Blocks UNION-based injection attacks
  - Blocks stacked queries
  - Blocks file operations (LOAD_FILE, INTO OUTFILE)
  - Query complexity limits: max 3 JOINs, max 2 nested subqueries
  - Automatic LIMIT enforcement (≤1500 for analysis, up to 10K for visualizations)

#### Input Validation
- **File Upload Security**:
  - MIME type validation (text/csv, text/plain)
  - File extension validation (.csv only)
  - Size limit: 20MB maximum
  - Empty file rejection
  - Column limit: 30 columns maximum
  - **CSV Formula Injection Protection**: Sanitizes dangerous formula prefixes (`=`, `+`, `@`, `|`, `\t`, `\r`). Smart handling for `-`: Allows negative numbers but blocks formula patterns

- **Rate Limiting** (PostgreSQL-based):
  - 5 uploads per hour per user (session-based tracking)
  - Automatic rate limit record cleanup via cron (older than 1 hour)
  - Graceful failure: Allows requests on database errors to prevent cascading failures

- **Storage Quota**:
  - Maximum 10 datasets per user to prevent resource exhaustion
  - Enforced before file upload processing
  - Clear error messages with current usage and limits

#### Infrastructure Security
- **HTTP Security Headers** (via next.config.mjs):
  - Content-Security-Policy (CSP) with Supabase/OpenAI whitelisting
  - X-Frame-Options: DENY (prevents clickjacking)
  - X-Content-Type-Options: nosniff (prevents MIME sniffing)
  - X-XSS-Protection: enabled
  - Referrer-Policy: strict-origin-when-cross-origin
  - Permissions-Policy (restricts camera, microphone, geolocation)
- **Connection Pool Limits**: Max 20 connections, 30s idle timeout, 10s connection timeout
- **Defense in Depth**: Explicit ownership verification on all data access routes

#### Error Handling
- **Helpful Error Messages**: Lists available columns on errors (for user convenience)
- **No Information Disclosure**: Generic error messages in production mode

#### Timeout Protection
- Route timeout: 300 seconds (5 minutes for entire analysis session)
- Individual query timeouts: 30s (normal mode), 60s (deep dive mode)
- Deep dive analysis typically completes in 4-5 minutes (within timeout limit)

#### Rate Limiting & Resource Protection
- **PostgreSQL-Based Rate Limiting**: Free, serverless-friendly rate limiting without external services
  - 5 uploads per hour per user (session-based)
  - Atomic increment using PostgreSQL function `check_rate_limit()`
  - Window-based tracking with automatic alignment (1-hour windows)
  - Fail-open strategy: Allows requests on database errors to prevent service disruption

- **Storage Quota Enforcement**:
  - Maximum 10 datasets per user
  - Checked before processing file upload
  - Prevents resource exhaustion and abuse

- **Automatic Cleanup**:
  - Rate limit records deleted after 1 hour (via cron cleanup job)
  - Minimal storage overhead for rate tracking

#### Data Retention & Privacy
- **Automatic Cleanup**: Datasets deleted after 24 hours via Vercel Cron
  - Cron schedule: Every 6 hours (`0 */6 * * *`)
  - Endpoint: `/api/datasets/cleanup`
  - Protected by Vercel Cron user-agent verification
- **Complete Deletion**: Drops dataset tables + cascades all metadata (runs, charts, reports)
- **Privacy Guarantee**: No permanent data storage - cleanup is automated, not manual

## Privacy & Data Retention

The application implements automatic data cleanup to protect user privacy:

### Automatic Data Deletion
- **Retention Period**: All uploaded datasets are automatically deleted after 24 hours
- **Cleanup Schedule**: Vercel Cron runs every 6 hours (`0 */6 * * *`) to remove expired data
- **What Gets Deleted**:
  - Dataset tables (`ds_<datasetId>`)
  - Metadata records (datasets, chat_turns, runs, reports) via CASCADE
  - All associated analysis artifacts
  - **Rate limit records** older than 1 hour (cleaned up during dataset cleanup)

### User Isolation
- **Session-Based Privacy**: Each user session is isolated via Row Level Security (RLS)
- **No Cross-User Access**: Users can only access their own datasets
- **No Login Required**: Anonymous authentication provides privacy without accounts

### Implementation Details
- Cleanup endpoint: `/api/datasets/cleanup`
- Configuration: `vercel.json` cron schedule
- Protected by user-agent verification (Vercel Cron only)
- Automatic CASCADE deletion for referential integrity

### Privacy Guarantee
**Your data is never stored permanently.** All uploaded datasets and analysis artifacts are automatically deleted after 24 hours. This is enforced by automated cleanup, not manual processes.

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
│       ├── chat/[datasetId]/route.ts       # API route handler (170 lines, refactored)
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
│   ├── ai-tools/                   # AI SDK tools (factory pattern)
│   │   ├── sql-query-tool.ts       # SQL execution tool (181 lines)
│   │   └── chart-tool.ts           # Chart generation tool (243 lines)
│   ├── charts/
│   │   └── chart-specs.ts          # Vega-Lite chart specifications (600 lines)
│   ├── prompts/
│   │   └── chat-prompts.ts         # System prompts for AI modes (400 lines)
│   ├── supabase/
│   │   ├── client.ts               # Supabase client (browser)
│   │   └── server.ts               # Supabase client (server)
│   ├── postgres.ts                 # Direct Postgres connection
│   ├── rate-limit.ts               # Rate limiting utility
│   ├── response-parser.ts          # Response parsing utilities
│   ├── session-cleanup.ts          # Session management utilities
│   ├── sql-guard.ts                # SQL safety validation
│   ├── sql-stats.ts                # SQL statistics utilities
│   ├── types.ts                    # TypeScript definitions
│   ├── utils.ts                    # Utility functions
│   ├── validation-utils.ts         # Field validation and fuzzy matching (93 lines)
│   ├── vega-config.ts              # Vega-Lite configuration
│   └── vega-validator.ts           # Vega-Lite validation
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

## Deployment

This project is configured for deployment on Vercel with automated data cleanup:

### Basic Deployment

1. **Push your code to GitHub**
2. **Import the repository in Vercel**
3. **Add environment variables** in Vercel project settings:
   - `OPENAI_API_KEY`
   - `SUPABASE_POSTGRES_URL_NON_POOLING`
   - `SUPABASE_POSTGRES_URL`
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. **Deploy**

### Vercel Cron Configuration

The application uses Vercel Cron for automated data cleanup:

**Configuration** (`vercel.json`):
```json
{
  "crons": [
    {
      "path": "/api/datasets/cleanup",
      "schedule": "0 */6 * * *"
    }
  ]
}
```

**Schedule**: Runs every 6 hours (at minute 0: 12am, 6am, 12pm, 6pm UTC)

**Purpose**: Automatically deletes datasets older than 24 hours

**What Gets Cleaned Up**:
- Datasets older than 24 hours (tables + metadata)
- Rate limit records older than 1 hour (automatic tracking cleanup)

**Requirements**:
- Available on all Vercel plans (Hobby, Pro, Enterprise)
- Uses Vercel Cron user-agent for authentication (no CRON_SECRET needed by default)
- Optional: Set `CRON_SECRET` environment variable for additional Bearer token authentication

**Testing Cleanup Locally**:
```bash
curl -X POST http://localhost:3000/api/datasets/cleanup
```

Note: Manual testing bypasses the Vercel Cron user-agent check in development mode.

### Live Demo

**Production URL**: [https://vercel.com/kaihon333haha-5908s-projects/v0-data-analyst-agent](https://vercel.com/kaihon333haha-5908s-projects/v0-data-analyst-agent)


## Contributing

Contributions are welcome! Please open an issue or submit a pull request.
