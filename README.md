# Obscura

Research beyond the answer. Obscura turns a research question into an interactive knowledge board: AI research agents search the web, plan directions, and stream findings, evidence, challenges and open gaps onto a graph you can explore, edit and annotate.

## Stack

Next.js 16 (App Router), React 19, React Flow, CopilotKit + AG-UI, Anthropic, Firecrawl, Tailwind CSS 4.

## Local development

```bash
npm install
cp .env.example .env.local   # then fill in the keys
npm run dev
```

Open http://localhost:3000.

## Environment variables

| Name | Required | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | yes | Research agents (server-side only) |
| `FIRECRAWL_API_KEY` | yes | Web search and page scraping (server-side only) |
| `RESEARCH_MODEL_PLANNER`, `RESEARCH_MODEL_BRANCH`, `RESEARCH_MODEL_SYNTHESIS`, `RESEARCH_MODEL_DEEP_DIVE`, `RESEARCH_MODEL_CHALLENGE`, `RESEARCH_MODEL_EVIDENCE`, `RESEARCH_MODEL_GAPS` | no | Override the model per research role |
| `NEXT_PUBLIC_SHOW_COSTS` | no | `1` shows token cost in production |
| `COPILOTKIT_TELEMETRY_DISABLED` | no | `true` turns off CopilotKit runtime telemetry |

## Deploying to Vercel

1. Import the GitHub repository in Vercel (framework preset: Next.js, default build command).
2. Add `ANTHROPIC_API_KEY` and `FIRECRAWL_API_KEY` under Project Settings, Environment Variables.
3. Deploy. The research API route sets `maxDuration = 300` for long streaming runs; plans with a lower limit cap it automatically.

Boards, notes and engagement statistics are stored in the browser's localStorage; no database is required.
