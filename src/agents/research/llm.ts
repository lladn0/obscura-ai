import Anthropic from "@anthropic-ai/sdk";

import { estimateCost, modelFor, supportsServerFallback, type ResearchRole, type TokenUsage } from "./models";

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic()); // reads ANTHROPIC_API_KEY server-side

export type LlmUsage = TokenUsage & { role: ResearchRole; model: string; branchId: string; costUsd: number };

/**
 * One streaming Claude request for a research role. `onText` receives raw
 * text deltas as they arrive; resolves with the full text and token usage.
 */
export async function streamClaude({
  role,
  branchId,
  system,
  prompt,
  effort,
  maxTokens = 4000,
  signal,
  onText,
}: {
  role: ResearchRole;
  branchId: string;
  system: string;
  prompt: string;
  effort: "low" | "medium" | "high";
  maxTokens?: number;
  signal?: AbortSignal;
  onText: (delta: string) => void;
}): Promise<{ text: string; usage: LlmUsage }> {
  const model = modelFor(role);
  const fallback = supportsServerFallback(model)
    ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
    : {};
  const stream = anthropic().beta.messages.stream(
    {
      model,
      max_tokens: maxTokens,
      ...fallback,
      output_config: { effort },
      // Marks the static instructions for caching. They are below the minimum
      // cacheable size today, so this is free and starts paying off if they grow.
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: prompt }],
    },
    { signal },
  );
  stream.on("text", onText);
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") throw new Error("The model declined this research request.");

  const u = message.usage;
  const tokens: TokenUsage = {
    input: u.input_tokens,
    output: u.output_tokens,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
  };
  const usage: LlmUsage = { ...tokens, role, model: message.model, branchId, costUsd: estimateCost(model, tokens) };
  console.info(
    `[llm] ${role.padEnd(9)} ${branchId.padEnd(16)} ${model} in=${tokens.input} out=${tokens.output} ` +
      `cacheR=${tokens.cacheRead} cacheW=${tokens.cacheWrite} ~$${usage.costUsd.toFixed(5)}`,
  );
  return { text: message.content.map((b) => (b.type === "text" ? b.text : "")).join(""), usage };
}
