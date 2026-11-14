import { streamClaude } from "@/agents/research/llm";
import { consume } from "@/server/rate-limit";

/** Knowledge check: 3-5 multiple-choice questions built only from grounded findings sent by the client. */
export const maxDuration = 60;

type Item = { nodeId: string; statement: string; quote?: string; source?: string };
type Question = { nodeId: string; question: string; options: string[]; answer: number; explanation: string };

const SYSTEM = `You write short multiple-choice knowledge checks for a research tool.
Use ONLY the numbered findings provided (their statements and source excerpts). Never add outside facts.
Write 3 to 5 questions, each about one finding, testing understanding rather than wording recall.
Each question has exactly 4 options, one correct; distractors must be plausible but clearly wrong given the finding.
Reply with JSON only: [{"finding": <number>, "question": "...", "options": ["...","...","...","..."], "answer": <0-3>, "explanation": "<one sentence citing the finding>"}]`;

export async function POST(req: Request) {
  const limited = consume(req);
  if (limited) return limited;

  let body: { topic?: string; items?: Item[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const items = (body.items ?? [])
    .filter((i) => typeof i?.nodeId === "string" && typeof i?.statement === "string" && i.statement.trim())
    .slice(0, 14)
    .map((i) => ({
      nodeId: i.nodeId.slice(0, 120),
      statement: i.statement.slice(0, 600),
      quote: i.quote?.slice(0, 400),
      source: i.source?.slice(0, 200),
    }));
  if (items.length < 3) return Response.json({ error: "Not enough grounded findings for a knowledge check." }, { status: 400 });

  const prompt =
    `Research topic: ${(body.topic ?? "").slice(0, 200)}\n\nFindings:\n` +
    items
      .map(
        (i, n) =>
          `${n + 1}. ${i.statement}` +
          (i.quote ? `\n   Source excerpt: "${i.quote}"` : "") +
          (i.source ? `\n   Source: ${i.source}` : ""),
      )
      .join("\n");

  try {
    const { text } = await streamClaude({
      role: "quiz",
      branchId: "quiz",
      system: SYSTEM,
      prompt,
      effort: "low",
      maxTokens: 2500,
      signal: req.signal,
      onText: () => {},
    });
    const json = text.slice(text.indexOf("["), text.lastIndexOf("]") + 1);
    const raw = JSON.parse(json) as { finding: number; question: string; options: string[]; answer: number; explanation: string }[];
    const questions: Question[] = raw
      .filter(
        (q) =>
          items[q.finding - 1] &&
          typeof q.question === "string" &&
          Array.isArray(q.options) &&
          q.options.length === 4 &&
          Number.isInteger(q.answer) &&
          q.answer >= 0 &&
          q.answer < 4,
      )
      .slice(0, 5)
      .map((q) => ({
        nodeId: items[q.finding - 1].nodeId,
        question: q.question,
        options: q.options.map(String),
        answer: q.answer,
        explanation: String(q.explanation ?? ""),
      }));
    if (questions.length < 3) throw new Error("too few questions");
    return Response.json({ questions });
  } catch (error) {
    console.error("[quiz]", error);
    return Response.json({ error: "Couldn't create a knowledge check right now. Please try again." }, { status: 502 });
  }
}
