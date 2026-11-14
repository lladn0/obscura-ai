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

All keys are read server-side only (never `NEXT_PUBLIC_`), so they are not shipped to the browser.

| Name | Required | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | yes | Research agents |
| `FIRECRAWL_API_KEY` | yes | Web search and page scraping |
| `RESEARCH_RATE_LIMIT_PER_HOUR` | no | Research runs per client IP per hour (default 20) |
| `RESEARCH_GLOBAL_LIMIT_PER_HOUR` | no | Research runs per server instance per hour (default 300) |
| `RESEARCH_TIME_LIMIT_MS` | no | Server-side stop for one run (default 285000, under the 300s function limit) |
| `RESEARCH_MODEL_PLANNER`, `RESEARCH_MODEL_BRANCH`, `RESEARCH_MODEL_SYNTHESIS`, `RESEARCH_MODEL_DEEP_DIVE`, `RESEARCH_MODEL_CHALLENGE`, `RESEARCH_MODEL_EVIDENCE`, `RESEARCH_MODEL_GAPS`, `RESEARCH_MODEL_QUIZ` | no | Override the model per research role (quiz: knowledge checks) |
| `NEXT_PUBLIC_SHOW_COSTS` | no | `1` shows token cost in production |
| `COPILOTKIT_TELEMETRY_DISABLED` | no | `true` turns off CopilotKit runtime telemetry |

## Deploying to Vercel

1. Import the GitHub repository in Vercel (framework preset Next.js, default build and output settings).
2. Add `ANTHROPIC_API_KEY` and `FIRECRAWL_API_KEY` (Production and Preview) under Project Settings, Environment Variables.
3. Deploy. No database, separate backend or extra service is needed.

### How research runs on Vercel

- The whole app, including the agents, runs as one Next.js deployment. `/api/copilotkit` is a Node.js Vercel Function; the LangGraph research workflow runs inside the request and streams AG-UI events back over the same response.
- `maxDuration = 300` (the Hobby maximum with Fluid compute). The agent stops itself at about 285s and tells the client; everything streamed so far is already on the board.
- Functions are not background workers: a research run lives only as long as its streaming request. Closing or reloading the tab ends the run, and a run cannot resume after a disconnect, timeout or redeploy. Results already received are saved in the browser.
- Boards, notes and statistics are stored in each browser's localStorage, so they are per device and are not shared between users.
- Abuse safeguard: research runs are rate limited per IP and per instance in memory. This is best-effort (each function instance has its own counters); use a shared store such as Upstash Redis if strict limits are needed.
