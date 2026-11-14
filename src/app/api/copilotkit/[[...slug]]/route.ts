import { CopilotRuntime, createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";

import { ResearchAgent } from "@/agents/research/agent";
import { RESEARCH_AGENT_ID } from "@/agents/research/protocol";

const runtime = new CopilotRuntime({
  agents: { [RESEARCH_AGENT_ID]: new ResearchAgent() },
});

const handler = createCopilotRuntimeHandler({ runtime, basePath: "/api/copilotkit" });

// Research runs stream for several minutes; let the platform (e.g. Vercel) keep the function alive.
export const maxDuration = 300;

export const GET = handler;
export const POST = handler;
