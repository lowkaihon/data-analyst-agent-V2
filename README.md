# Data Analyst Agent

An AI-powered data analysis platform that enables interactive exploration of CSV datasets through natural conversation. Upload your data, ask questions, and let the AI autonomously run SQL queries, generate visualizations, validate findings, and produce comprehensive reports.

[![Deployed on Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-black?style=for-the-badge&logo=vercel)](https://vercel.com/kaihon333haha-5908s-projects/v0-data-analyst-agent)
[![Built with v0](https://img.shields.io/badge/Built%20with-v0.app-black?style=for-the-badge)](https://v0.app/chat/projects/WdUJaFsY9r0)

## Features

### 🤖 AI-Powered Analysis
- **Autonomous SQL Execution**: AI automatically writes and runs SQL queries against your data
- **Smart Visualizations**: Generates Vega-Lite charts based on data patterns and user intent
- **Data Validation**: Performs quality checks for nulls, outliers, and duplicates
- **Statistical Profiling**: Provides column-level statistics and data summaries
- **Contextual Insights**: AI understands your data context and suggests relevant explorations

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
- **AI SDK 5** for streaming chat with tool calling
- **Vega-Lite** for data visualizations
- **Lucide React** for icons

### Backend
- **Supabase Postgres** for data storage and dynamic table creation
- **OpenAI GPT-4o** for AI agent capabilities
- **Node.js Runtime** for API routes with SQL operations

### AI Tools (Server-Side)
1. `executeSQLQuery`: Runs SELECT-only queries with automatic LIMIT enforcement
2. `suggestViz`: Generates Vega-Lite chart specifications
3. `validate`: Performs data quality checks
4. `profile`: Provides statistical summaries

## Getting Started

### Prerequisites
- Node.js 18+ 
- Supabase account with Postgres database
- OpenAI API key

### Installation

1. Clone the repository:
\`\`\`bash
git clone https://github.com/yourusername/data-analyst-agent.git
cd data-analyst-agent
\`\`\`

2. Install dependencies:
\`\`\`bash
npm install
\`\`\`

3. Set up environment variables:
\`\`\`bash
# Copy the example env file
cp .env.example .env.local

# Add your credentials:
# - SUPABASE_* variables (from Supabase project settings)
# - OPENAI_API_KEY (from OpenAI dashboard)
# - NEON_* variables (if using Neon for Postgres)
\`\`\`

4. Initialize the database:
\`\`\`bash
# Run the SQL scripts in /scripts to create tables
# Execute scripts/001_create_schema.sql in your Supabase SQL editor
# Execute scripts/002_initialize_database.sql
\`\`\`

5. Run the development server:
\`\`\`bash
npm run dev
\`\`\`

6. Open [http://localhost:3000](http://localhost:3000) in your browser

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

### Data Flow
1. **CSV Upload** → Parsed and inserted into Postgres table `ds_<datasetId>`
2. **User Question** → AI agent plans analysis approach
3. **Tool Execution** → Server-side tools run SQL, generate charts, validate data
4. **Streaming Response** → Results streamed back to client with artifacts
5. **Artifact Storage** → All queries, charts, and insights saved to `runs` table

### Database Schema
- `datasets`: Metadata about uploaded CSV files
- `chat_turns`: Conversation history
- `runs`: Unified artifacts (SQL queries, charts, validations)
- `reports`: Generated markdown reports
- `ds_<datasetId>`: Dynamic tables for each uploaded dataset

### Security
- **SQL Safety**: SELECT-only queries with automatic LIMIT (≤500 rows)
- **Timeout Protection**: 5-second query timeout
- **Input Validation**: CSV size and column limits enforced
- **Session-Based**: Datasets deleted on browser close

## Project Structure

\`\`\`
├── app/
│   ├── page.tsx                    # Upload interface (Stage 0)
│   ├── analyze/page.tsx            # Split-view analysis (Stage 1)
│   └── api/
│       ├── chat/[datasetId]/       # AI chat with tools
│       ├── ingest/                 # CSV upload and table creation
│       ├── preview/                # Data preview endpoint
│       ├── schema/                 # Schema metadata
│       ├── runs/                   # Artifact management
│       └── report/                 # Report generation
├── components/
│   ├── chat-panel.tsx              # Chat interface with AI SDK
│   ├── dataset-tabs.tsx            # Tabbed dataset viewer
│   ├── history-drawer.tsx          # Artifact search and filter
│   └── tabs/                       # Individual tab components
├── lib/
│   ├── supabase/                   # Supabase client utilities
│   ├── postgres.ts                 # Direct Postgres connection
│   ├── sql-guard.ts                # SQL safety validation
│   └── types.ts                    # TypeScript definitions
└── scripts/
    └── *.sql                       # Database initialization
\`\`\`

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
