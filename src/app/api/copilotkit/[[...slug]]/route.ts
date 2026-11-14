import { CopilotRuntime, createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";

import { ResearchAgent } from "@/agents/research/agent";
import { RESEARCH_AGENT_ID } from "@/agents/research/protocol";
import { limitResearch } from "@/server/rate-limit";

const runtime = new CopilotRuntime({
  agents: { [RESEARCH_AGENT_ID]: new ResearchAgent() },
});

const handler = createCopilotRuntimeHandler({ runtime, basePath: "/api/copilotkit" });

// Runs on the default Node.js runtime (Cache Components does not allow a `runtime` export).
// A research run is one streaming request (AG-UI over SSE) executed inside this function;
// Vercel allows up to 300s, and the agent stops itself just before that (see RUN_TIME_LIMIT_MS).
export const maxDuration = 300;

export const GET = handler;
export const POST = async (req: Request) => (await limitResearch(req)) ?? handler(req);
