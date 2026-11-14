import { Annotation, END, Send, START, StateGraph, type LangGraphRunnableConfig } from "@langchain/langgraph";
import { z } from "zod";

import { MAX_AUTO_DEPTH } from "@/graph/research-depth";
import { runAction } from "./actions";
import {
  emitter,
  fieldTarget,
  IMAGE_RULE,
  imageData,
  imageQuery,
  oneLine,
  research,
  streamFindings,
  type Configurable,
  type FindingSummary,
} from "./kit";
import { streamClaude } from "./llm";
import type { ActionRequest } from "./protocol";
import { createRecordStream, type ParsedRecord } from "./record-stream";
import { researchScheduler } from "./scheduler";

export type { ResearchChunk, ResearchUsage } from "./kit";

/**
 * Research workflow with three logical roles:
 *   Planner             one request: 3-5 research directions (depth 1)
 *   Researcher          Firecrawl search per branch: real pages and URLs
 *   Architect + Critic  one request per branch: findings (depth 2) with
 *                       verification status and source ids
 * Branches fan out with Send and run through the shared scheduler (3 at a time).
 * Runs that carry an `action` skip planning and investigate one node instead.
 */

type BranchPlan = { branchId: string; nodeId: string; title: string; summary: string; query: string; depth: number };

const ResearchState = Annotation.Root({
  researchId: Annotation<string>,
  question: Annotation<string>,
  branches: Annotation<BranchPlan[]>({ reducer: (_, next) => next, default: () => [] }),
  findings: Annotation<FindingSummary[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  /** Set only on the per-branch Send payload. */
  branch: Annotation<BranchPlan | undefined>,
  /** Set when the run is a user action on one node instead of a new question. */
  action: Annotation<ActionRequest | undefined>,
});
type State = typeof ResearchState.State;


const DirectionSchema = z.object({ TITLE: oneLine(120), SUMMARY: oneLine(400), QUERY: oneLine(200), IMAGE: imageQuery });

const SynthesisSchema = z.object({
  TITLE: oneLine(160),
  SUMMARY: oneLine(800),
  CONFIDENCE: z.coerce.number().min(0).max(1).catch(0.5),
});

// --- Prompts --------------------------------------------------------------------

const PLANNER_SYSTEM = `You are the planner of a research assistant that builds a visual knowledge map.
Split the user's research question into 3 to 5 distinct, non-overlapping research directions that together answer it.
${IMAGE_RULE}
Output ONLY records in exactly this format, no other text, no markdown:

DIRECTION
TITLE: <direction title, at most 6 words>
SUMMARY: <one sentence, at most 20 words, on what this direction investigates>
QUERY: <a focused web search query for this direction>
IMAGE: <specific image search query, or none>

Separate records with a blank line. Each field value stays on one line.`;

const SYNTHESIS_SYSTEM = `You write the short answer at the centre of a research map.
Given the research question and the findings from each direction (with their verification status),
answer the question. Rely on verified findings; flag uncertainty where findings are unverified or contested.
Output ONLY one record in exactly this format, no other text:

ANSWER
TITLE: <the answer in at most 12 words>
SUMMARY: <2 sentences, at most 50 words, explaining the answer and its main uncertainty>
CONFIDENCE: <a number between 0 and 1>`;

// --- Graph nodes ------------------------------------------------------------------

/** Planner: root question node immediately, then 3-5 streamed direction nodes. */
async function plan(state: State, config: LangGraphRunnableConfig) {
  const { researchId, question } = state;
  const rootId = `${researchId}:root`;
  const root = emitter(config, researchId, "root");
  root.write({ type: "phase", phase: "planning" });
  root.created(rootId, "question", { status: "exploring" });
  root.text(rootId, "label", question);
  root.completed(rootId);

  const branchOf = (r: ParsedRecord) => `${researchId}:b${r.index + 1}`;
  const emitters = new Map<string, ReturnType<typeof emitter>>();
  const em = (r: ParsedRecord) => {
    const id = branchOf(r);
    if (!emitters.has(id)) emitters.set(id, emitter(config, researchId, id));
    return emitters.get(id)!;
  };
  const branches: BranchPlan[] = [];

  const parser = createRecordStream({
    kinds: ["DIRECTION"],
    streamedFields: ["TITLE", "SUMMARY"],
    onRecordStart: (r) => {
      if (r.index >= 5) return;
      const e = em(r);
      e.created(`${branchOf(r)}:direction`, "claim");
      e.edge(`${branchOf(r)}:direction`, "explains", rootId);
    },
    onFieldDelta: (r, field, delta) => {
      if (r.index < 5) em(r).text(`${branchOf(r)}:direction`, fieldTarget(field), delta);
    },
    onRecordEnd: (r) => {
      if (r.index >= 5) return;
      const e = em(r);
      const nodeId = `${branchOf(r)}:direction`;
      const parsed = DirectionSchema.safeParse(r.fields);
      if (!parsed.success) {
        e.completed(nodeId, { verification: "unverified" });
        return;
      }
      const d = parsed.data;
      e.completed(nodeId, { label: d.TITLE, description: d.SUMMARY, ...imageData(d.IMAGE) });
      e.branch(d.TITLE, "queued");
      branches.push({ branchId: branchOf(r), nodeId, title: d.TITLE, summary: d.SUMMARY, query: d.QUERY, depth: 1 });
    },
  });

  const { usage } = await streamClaude({
    role: "planner",
    branchId: "root",
    system: PLANNER_SYSTEM,
    prompt: `Research question: ${question}`,
    effort: "low",
    maxTokens: 4000,
    signal: config.signal,
    onText: parser.push,
  });
  parser.end();
  root.usage({ kind: "llm", ...usage });
  if (branches.length === 0) throw new Error("Planning produced no research directions.");

  root.write({ type: "phase", phase: "researching" });
  return { branches };
}

/** One independent branch worker: Researcher, then Architect + Critic in one streaming request. */
async function researchBranch(state: State, config: LangGraphRunnableConfig) {
  const b = state.branch!;
  const { researchId, question } = state;
  const ctx = config.configurable as Configurable;
  const e = emitter(config, researchId, b.branchId);

  // Automatic research stops at MAX_AUTO_DEPTH; deeper levels are user-initiated (Deep Dive).
  if (b.depth + 1 > MAX_AUTO_DEPTH) return {};

  return researchScheduler.run(async () => {
    e.branch(b.title, "researching");
    try {
      const sources = await research(e, ctx, b.branchId, b.query, `${b.title} ${b.summary}`);
      const findings = await streamFindings({
        e,
        ctx,
        config,
        role: "branch",
        branchId: b.branchId,
        parentId: b.nodeId,
        idPrefix: b.branchId,
        prompt: `Research question: ${question}
Research direction: ${b.title} — ${b.summary}`,
        sources,
      });
      e.branch(b.title, "done");
      return { findings };
    } catch (error) {
      if (config.signal?.aborted) throw error;
      e.branch(b.title, "error");
      return {};
    }
  }, "auto");
}

/** A user-initiated action on one node (Deep Dive, Challenge, Find Evidence, Research Gaps). */
async function investigate(state: State, config: LangGraphRunnableConfig) {
  const e = emitter(config, state.researchId, state.action!.actionId);
  const result = await runAction(state.action!, config);
  e.write({ type: "result", ...result });
  return {};
}

/** Structuring: one short request for the answer node at the centre. */
async function structure(state: State, config: LangGraphRunnableConfig) {
  const { researchId, question } = state;
  const e = emitter(config, researchId, "synthesis");
  e.write({ type: "phase", phase: "structuring" });

  if (state.findings.length) {
    const id = `${researchId}:synthesis`;
    let created = false;
    const parser = createRecordStream({
      kinds: ["ANSWER"],
      streamedFields: ["TITLE", "SUMMARY"],
      onRecordStart: (r) => {
        if (r.index > 0) return;
        created = true;
        e.created(id, "insight");
        e.edge(id, "explains", `${researchId}:root`);
      },
      onFieldDelta: (r, field, delta) => {
        if (r.index === 0) e.text(id, fieldTarget(field), delta);
      },
      onRecordEnd: (r) => {
        if (r.index > 0) return;
        const parsed = SynthesisSchema.safeParse(r.fields);
        e.completed(id, parsed.success ? { label: parsed.data.TITLE, description: parsed.data.SUMMARY, confidence: parsed.data.CONFIDENCE } : {});
      },
    });
    const byBranch = state.branches
      .map((b) => {
        const lines = state.findings.filter((f) => f.branchId === b.branchId).map((f) => `  - [${f.verification}] ${f.title}`);
        return `${b.title}:\n${lines.join("\n") || "  (no findings)"}`;
      })
      .join("\n");
    const { usage } = await streamClaude({
      role: "synthesis",
      branchId: "synthesis",
      system: SYNTHESIS_SYSTEM,
      prompt: `Research question: ${question}\n\nFindings by direction:\n${byBranch}`,
      effort: "low",
      maxTokens: 3000,
      signal: config.signal,
      onText: parser.push,
    });
    parser.end();
    e.usage({ kind: "llm", ...usage });
    if (!created) throw new Error("Synthesis produced no answer.");
  }

  e.write({ type: "phase", phase: "completed" });
  return {};
}

export const researchGraph = new StateGraph(ResearchState)
  .addNode("plan", plan)
  .addNode("researchBranch", researchBranch)
  .addNode("structure", structure)
  .addNode("investigate", investigate)
  .addConditionalEdges(START, (s: State) => (s.action ? "investigate" : "plan"), ["investigate", "plan"])
  .addEdge("investigate", END)
  .addConditionalEdges("plan", (s: State) => s.branches.map((branch) => new Send("researchBranch", { ...s, branch })), [
    "researchBranch",
  ])
  .addEdge("researchBranch", "structure")
  .addEdge("structure", END)
  .compile();
