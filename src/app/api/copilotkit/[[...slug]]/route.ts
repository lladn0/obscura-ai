import { CopilotRuntime, createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";

import { ResearchAgent } from "@/agents/research/agent";
import { RESEARCH_AGENT_ID } from "@/agents/research/protocol";

const runtime = new CopilotRuntime({
  agents: { [RESEARCH_AGENT_ID]: new ResearchAgent() },
});

const handler = createCopilotRuntimeHandler({ runtime, basePath: "/api/copilotkit" });

export const GET = handler;
export const POST = handler;
