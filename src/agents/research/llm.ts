import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-5-5";

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic()); // reads ANTHROPIC_API_KEY server-side

/**
 * One streaming Claude request. `onText` receives raw text deltas as they
 * arrive; the full text is returned once the message completes.
 * Server-side refusal fallbacks are on, so a declined request is retried on a
 * fallback model inside the same call.
 */
export async function streamClaude({
  system,
  prompt,
  effort,
  maxTokens = 8000,
  signal,
  onText,
}: {
  system: string;
  prompt: string;
  effort: "low" | "medium" | "high";
  maxTokens?: number;
  signal?: AbortSignal;
  onText: (delta: string) => void;
}): Promise<string> {
  const stream = anthropic().beta.messages.stream(
    {
      model: MODEL,
      max_tokens: maxTokens,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort },
      system,
      messages: [{ role: "user", content: prompt }],
    },
    { signal },
  );
  stream.on("text", onText);
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") throw new Error("The model declined this research request.");
  return message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}
