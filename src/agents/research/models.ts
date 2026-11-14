/**
 * Model per research role. Override with env vars, e.g.
 *   RESEARCH_MODEL_BRANCH=claude-sonnet-5-5
 */
export type ResearchRole = "planner" | "branch" | "synthesis";

const DEFAULT_MODELS: Record<ResearchRole, string> = {
  // Structured extraction with a fixed format: the cheap, fast model does well.
  planner: "claude-haiku-5-5",
  branch: "claude-haiku-5-5",
  // Weighing verified vs contested findings into one answer: worth Sonnet,
  // and its input is only a short list of finding titles.
  synthesis: "claude-sonnet-5-5",
};

const ENV_KEYS: Record<ResearchRole, string> = {
  planner: "RESEARCH_MODEL_PLANNER",
  branch: "RESEARCH_MODEL_BRANCH",
  synthesis: "RESEARCH_MODEL_SYNTHESIS",
};

export const modelFor = (role: ResearchRole) => process.env[ENV_KEYS[role]] || DEFAULT_MODELS[role];

/** USD per million tokens (Anthropic list prices; Haiku 5.5 rate is for prompts up to 100K). */
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
};

export type TokenUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

/** Estimated cost: cache writes bill at 1.25x input, cache reads at 0.1x. */
export function estimateCost(model: string, u: TokenUsage): number {
  const p = PRICES[model];
  if (!p) return 0;
  return (u.input * p.input + u.cacheWrite * p.input * 1.25 + u.cacheRead * p.input * 0.1 + u.output * p.output) / 1e6;
}

/** Haiku has no server-side refusal fallback; the larger models do. */
export const supportsServerFallback = (model: string) => !model.startsWith("claude-haiku");
