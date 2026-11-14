import { Annotation, END, Send, START, StateGraph, type LangGraphRunnableConfig } from "@langchain/langgraph";
import { z } from "zod";

import { MAX_AUTO_DEPTH } from "@/graph/research-depth";
import { guidanceOf, runAction } from "./actions";
import {
  emitter,
  fieldTarget,
  formatSources,
  UNTRUSTED_SOURCES,
  IMAGE_RULE,
  imageData,
  imageQuery,
  importance,
  IMPORTANCE_RULE,
  oneLine,
  research,
  streamFindings,
  type Configurable,
  type FindingSummary,
} from "./kit";
import { streamClaude } from "./llm";
import type { ActionRequest } from "./protocol";
import { createRecordStream } from "./record-stream";
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

type BranchPlan = {
  branchId: string;
  nodeId: string;
  title: string;
  summary: string;
  query: string;
  depth: number;
  /** What the research is about, as established by the grounding search. */
  subject: string;
  /** The question this branch serves (the root question, or a follow-up with its context). */
  question: string;
};

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


const MAX_DIRECTIONS = 6;
const DirectionSchema = z.object({ TITLE: oneLine(120), SUMMARY: oneLine(400), QUERY: oneLine(200), IMAGE: imageQuery, IMPORTANCE: importance(1, 0.75, 0.5) });

const SynthesisSchema = z.object({
  TITLE: oneLine(160),
  SUMMARY: oneLine(800),
  CONFIDENCE: z.coerce.number().min(0).max(1).catch(0.5),
});

// --- Prompts --------------------------------------------------------------------

const PLANNER_SYSTEM = `You are the planner of a research assistant that builds a visual knowledge map.

Step 1, understand the question. Work out exactly what the user is asking about. The web sources below were
retrieved for the question itself: use them to establish the identity of any named entity, event, product,
organisation or unfamiliar term. Names are labels: never infer what a subject is from the ordinary meaning of the
words in its name (for example, an event called "Unfair Weekend" is a named event, not a story about unfairness).

${UNTRUSTED_SOURCES}

Step 2, plan. Choose the research directions needed to answer the question about THAT subject.
- Use as few directions as the question needs: a narrow factual question may need 1 or 2, a broad topic more
  (at most ${MAX_DIRECTIONS}). Never add directions to reach a count; quality beats symmetry.
- Every direction must directly serve the user's question about the identified subject. No generic filler, no
  speculation, and no controversy, public reaction or history angles unless the question or the sources call for them.
- Directions must not overlap.
- QUERY is a focused web search query that names the identified subject explicitly.
${IMPORTANCE_RULE}
${IMAGE_RULE}

If the sources do not establish what the subject is and the question could reasonably mean different things,
do not invent a narrative: output a single CLARIFY record and nothing else.

Output ONLY records in exactly this format, no other text, no markdown:

SUBJECT
WHAT: <one sentence: what the subject is, grounded in the sources>

DIRECTION
TITLE: <direction title, at most 6 words>
SUMMARY: <one sentence, at most 20 words, on what this direction investigates>
QUERY: <a focused web search query for this direction>
IMPORTANCE: high | medium | low
IMAGE: <short image search query, or none>

(or, only when the subject cannot be identified)

CLARIFY
QUESTION: <one short clarifying question for the user>

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

type PlanInput = {
  researchId: string;
  /** Prefix for generated ids (unique per run). */
  idBase: string;
  rootId: string;
  /** The question to plan for (a follow-up keeps its parent's question as context). */
  question: string;
  /** Extra lines for the planner: parent question, user guidance. */
  context?: string;
  /** Grounding search query, when the question alone lacks its subject. */
  searchQuery?: string;
};

/**
 * Grounding search on the question itself, then one planner request that
 * identifies the subject and streams only the directions it needs.
 */
async function planResearch(config: LangGraphRunnableConfig, input: PlanInput) {
  const { researchId, idBase, rootId, question } = input;
  const ctx = config.configurable as Configurable;
  const root = emitter(config, researchId, "root");
  const grounding = await research(root, ctx, "root", (input.searchQuery ?? question).slice(0, 200), question);

  const branchOf = (n: number) => `${idBase}:b${n}`;
  const emitters = new Map<string, ReturnType<typeof emitter>>();
  const em = (n: number) => {
    const id = branchOf(n);
    if (!emitters.has(id)) emitters.set(id, emitter(config, researchId, id));
    return emitters.get(id)!;
  };
  /** Direction number per record (records also include SUBJECT/CLARIFY). */
  const dirNo = new Map<number, number>();
  const branches: BranchPlan[] = [];
  let subject = "";
  let clarify = "";

  const parser = createRecordStream({
    kinds: ["SUBJECT", "DIRECTION", "CLARIFY"],
    streamedFields: ["TITLE", "SUMMARY"],
    onRecordStart: (r) => {
      if (r.kind !== "DIRECTION" || dirNo.size >= MAX_DIRECTIONS) return;
      const n = dirNo.size + 1;
      dirNo.set(r.index, n);
      const e = em(n);
      // Folded from the start: only the question and its main branches show while research continues below.
      e.created(`${branchOf(n)}:direction`, "claim", {}, true);
      e.edge(`${branchOf(n)}:direction`, "explains", rootId);
    },
    onFieldDelta: (r, field, delta) => {
      const n = dirNo.get(r.index);
      if (n) em(n).text(`${branchOf(n)}:direction`, fieldTarget(field), delta);
    },
    onRecordEnd: (r) => {
      if (r.kind === "SUBJECT") {
        subject = (r.fields.WHAT ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
        return;
      }
      if (r.kind === "CLARIFY") {
        clarify = (r.fields.QUESTION ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
        return;
      }
      const n = dirNo.get(r.index);
      if (!n) return;
      const e = em(n);
      const nodeId = `${branchOf(n)}:direction`;
      const parsed = DirectionSchema.safeParse(r.fields);
      if (!parsed.success) {
        e.completed(nodeId, { verification: "unverified" });
        return;
      }
      const d = parsed.data;
      e.completed(nodeId, { label: d.TITLE, description: d.SUMMARY, importance: d.IMPORTANCE, ...imageData(d.IMAGE) });
      e.branch(d.TITLE, "queued");
      branches.push({
        branchId: branchOf(n),
        nodeId,
        title: d.TITLE,
        summary: d.SUMMARY,
        query: d.QUERY,
        depth: 1,
        subject,
        question: input.context ? `${question}\n${input.context}` : question,
      });
    },
  });

  const { usage } = await streamClaude({
    role: "planner",
    branchId: "root",
    system: PLANNER_SYSTEM,
    prompt: `Research question: ${question}${input.context ? `\n${input.context}` : ""}\n\n${formatSources(grounding)}`,
    effort: "low",
    maxTokens: 4000,
    signal: config.signal,
    onText: parser.push,
  });
  parser.end();
  root.usage({ kind: "llm", ...usage });

  // Ambiguous subject: ask instead of inventing a narrative.
  if (!branches.length && clarify) {
    const id = `${idBase}:clarify`;
    root.created(id, "question", { status: "open", gap: "unanswered", parentQuestionId: rootId });
    root.edge(id, "related_to", rootId);
    root.text(id, "label", clarify);
    root.completed(id, {
      description: "The subject is ambiguous. Add context to the question (details panel) or ask a follow-up.",
    });
  }
  if (subject) root.completed(rootId, { description: subject });
  return { branches, clarify };
}

/** Planner: root question node immediately, then only the directions the question needs. */
async function plan(state: State, config: LangGraphRunnableConfig) {
  const { researchId, question } = state;
  const rootId = `${researchId}:root`;
  const root = emitter(config, researchId, "root");
  root.write({ type: "phase", phase: "planning" });
  root.created(rootId, "question", { status: "exploring" });
  root.text(rootId, "label", question);
  root.completed(rootId);

  const { branches, clarify } = await planResearch(config, { researchId, idBase: researchId, rootId, question });
  if (branches.length === 0 && !clarify) throw new Error("Planning produced no research directions.");

  root.write({ type: "phase", phase: branches.length ? "researching" : "completed" });
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
        prompt: `Research question: ${b.question || question}
${b.subject ? `Subject (as identified from the web): ${b.subject}\n` : ""}Research direction: ${b.title} — ${b.summary}`,
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

/**
 * Follow-up question under an existing question: a new question node, then a
 * focused plan and its branches. Inherits only the parent's question path and
 * user guidance, never unrelated board content.
 */
async function followUp(state: State, config: LangGraphRunnableConfig) {
  const a = state.action!;
  const t = a.target;
  const e = emitter(config, state.researchId, a.actionId);
  e.created(t.id, "question", { status: "exploring", parentQuestionId: t.questionId ?? t.parentId });
  if (t.parentId) e.edge(t.id, "explains", t.parentId);
  e.text(t.id, "label", t.label);
  e.completed(t.id);

  const context = [
    t.path.length ? `It is a follow-up within: ${t.path.join(" > ")}` : "",
    t.description ? `About: ${t.description}` : "",
    guidanceOf(t).trim(),
  ]
    .filter(Boolean)
    .join("\n");
  const { branches } = await planResearch(config, {
    researchId: state.researchId,
    idBase: a.actionId,
    rootId: t.id,
    question: t.label,
    context,
    // "How did European banks contribute?" needs its parent's subject to search well.
    searchQuery: `${t.label} ${t.path[t.path.length - 1] ?? ""}`.trim(),
  });
  const results = await Promise.all(branches.map((branch) => researchBranch({ ...state, branch }, config)));
  const findings = results.reduce((sum, r) => sum + (("findings" in r && r.findings?.length) || 0), 0);
  return {
    added: branches.length + findings,
    message: branches.length
      ? `Follow-up researched ${branches.length} direction${branches.length > 1 ? "s" : ""} with ${findings} findings.`
      : "The follow-up needs clarification before it can be researched.",
  };
}

/** A user-initiated action on one node (Deep Dive, Challenge, Find Evidence, Research Gaps, Follow-up). */
async function investigate(state: State, config: LangGraphRunnableConfig) {
  const e = emitter(config, state.researchId, state.action!.actionId);
  const result = state.action!.kind === "followUp" ? await followUp(state, config) : await runAction(state.action!, config);
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
