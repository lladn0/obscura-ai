import { Annotation, END, Send, START, StateGraph, type LangGraphRunnableConfig } from "@langchain/langgraph";

import type { EdgeRelation, NodeKind } from "@/graph/types";
import { GraphEvent, type BranchStatus, type GraphEventPayload, type ResearchPhase } from "./protocol";

/**
 * Research workflow. Stage 3 streams SIMULATED content so the AG-UI pipeline
 * can be exercised end to end; Stage 4 replaces the content with real research.
 */

/** What graph nodes write to LangGraph's custom stream; the agent maps it to AG-UI events. */
export type ResearchChunk =
  | { type: "graph"; event: GraphEventPayload }
  | { type: "phase"; phase: ResearchPhase }
  | { type: "branch"; branchId: string; label: string; status: BranchStatus };

type BranchPlan = { branchId: string; label: string; description: string; template: number };

const ResearchState = Annotation.Root({
  researchId: Annotation<string>,
  question: Annotation<string>,
  branches: Annotation<BranchPlan[]>({ reducer: (_, next) => next, default: () => [] }),
  /** Set only on the per-branch Send payload. */
  branch: Annotation<BranchPlan | undefined>,
});
type State = typeof ResearchState.State;

// --- Streaming helpers ------------------------------------------------------

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), reject(new Error("aborted"))), { once: true });
  });
const jitter = (min: number, max: number) => min + Math.random() * (max - min);

/** Emits graph operations for one branch, with per-node text sequence numbers. */
function emitter(config: LangGraphRunnableConfig, researchId: string, branchId: string) {
  const write = (chunk: ResearchChunk) => config.writer?.(chunk);
  const seq = new Map<string, number>();
  const signal = config.signal;

  const edge = (source: string, relation: EdgeRelation, target: string) =>
    write({
      type: "graph",
      event: {
        name: GraphEvent.EdgeCreated,
        value: { researchId, branchId, edgeId: `${source}-${relation}-${target}`, source, target, relation },
      },
    });

  /**
   * Creates a node in its generating state, connects it (both endpoints exist
   * now), streams its text 1-3 words at a time, then marks it complete.
   */
  const node = async (
    nodeId: string,
    kind: NodeKind,
    text: { label: string; description?: string },
    data: Record<string, unknown> = {},
    links: [string, EdgeRelation, string][] = [],
  ) => {
    write({
      type: "graph",
      event: { name: GraphEvent.NodeCreated, value: { researchId, branchId, nodeId, kind, data: { ...data, demo: true } } },
    });
    for (const [source, relation, target] of links) edge(source, relation, target);
    for (const field of ["label", "description"] as const) {
      const full = text[field];
      if (!full) continue;
      const words = full.split(/(?<=\s)/);
      for (let i = 0; i < words.length; ) {
        const n = 1 + Math.floor(Math.random() * 3);
        const delta = words.slice(i, i + n).join("");
        i += n;
        const s = (seq.get(nodeId) ?? 0) + 1;
        seq.set(nodeId, s);
        write({ type: "graph", event: { name: GraphEvent.NodeText, value: { researchId, branchId, nodeId, seq: s, field, delta } } });
        await sleep(jitter(30, 90), signal);
      }
    }
    write({ type: "graph", event: { name: GraphEvent.NodeCompleted, value: { researchId, branchId, nodeId } } });
  };

  return { write, node, edge, signal };
}

// --- Simulated content ------------------------------------------------------

const DIRECTIONS = [
  {
    label: "Background and context",
    description: "Where the question comes from and which earlier developments shaped it.",
    finding: "Earlier conditions set the stage",
    findingText: "Several preconditions appear repeatedly across accounts of this topic.",
    evidence: "Timelines point to a gradual build-up",
    source: "Overview article (simulated)",
  },
  {
    label: "Key mechanisms",
    description: "The causal processes that most explanations rely on.",
    finding: "A small set of drivers reinforce each other",
    findingText: "Feedback between the main drivers explains why effects were amplified.",
    evidence: "Case data shows drivers moving together",
    source: "Research paper (simulated)",
  },
  {
    label: "Competing perspectives",
    description: "Where experts disagree, and what each side emphasises.",
    finding: "Disagreement centres on relative weight, not existence",
    findingText: "Most camps accept the same factors but rank their importance differently.",
    evidence: "Expert surveys show split rankings",
    source: "Policy report (simulated)",
  },
  {
    label: "Evidence gaps and open questions",
    description: "What remains uncertain and what would resolve it.",
    finding: "Measurement limits leave key effects uncertain",
    findingText: "Better data on a few variables would settle much of the debate.",
    evidence: "Studies report wide confidence intervals",
    source: "Systematic review (simulated)",
  },
];

// --- Graph nodes -------------------------------------------------------------

async function plan(state: State, config: LangGraphRunnableConfig) {
  const { researchId, question } = state;
  const e = emitter(config, researchId, "root");
  e.write({ type: "phase", phase: "planning" });
  await e.node(`${researchId}:root`, "question", { label: question }, { status: "exploring" });

  const branches = DIRECTIONS.map((d, i) => ({
    branchId: `${researchId}:b${i + 1}`,
    label: d.label,
    description: d.description,
    template: i,
  }));
  for (const b of branches) e.write({ type: "branch", branchId: b.branchId, label: b.label, status: "queued" });
  await sleep(400, e.signal);
  e.write({ type: "phase", phase: "researching" });
  return { branches };
}

/** One independent branch task; LangGraph runs all of them concurrently. */
async function researchBranch(state: State, config: LangGraphRunnableConfig) {
  const b = state.branch!;
  const t = DIRECTIONS[b.template];
  const root = `${state.researchId}:root`;
  const id = (suffix: string) => `${b.branchId}:${suffix}`;
  const e = emitter(config, state.researchId, b.branchId);

  await sleep(jitter(0, 600), e.signal);
  e.write({ type: "branch", branchId: b.branchId, label: b.label, status: "researching" });

  // Depth 1: the research direction itself.
  await e.node(id("direction"), "claim", { label: b.label, description: b.description }, { confidence: jitter(0.55, 0.9) }, [
    [id("direction"), "explains", root],
  ]);

  // Depth 2 (MAX_AUTO_DEPTH): a finding, plus supporting evidence and its source.
  await e.node(id("finding"), "claim", { label: t.finding, description: t.findingText }, { confidence: jitter(0.5, 0.85) }, [
    [id("finding"), "supports", id("direction")],
  ]);

  await e.node(
    id("evidence"),
    "evidence",
    { label: t.evidence, description: "Simulated evidence for pipeline testing." },
    { stance: "supporting" },
    [[id("evidence"), "supports", id("finding")]],
  );

  await e.node(id("source"), "source", { label: t.source }, { sourceType: "article" }, [
    [id("evidence"), "sourced_from", id("source")],
  ]);

  e.write({ type: "branch", branchId: b.branchId, label: b.label, status: "done" });
  return {};
}

async function structure(state: State, config: LangGraphRunnableConfig) {
  const e = emitter(config, state.researchId, "synthesis");
  e.write({ type: "phase", phase: "structuring" });
  const [first, second] = state.branches;
  if (first && second) e.edge(`${second.branchId}:direction`, "related_to", `${first.branchId}:direction`);

  const insight = `${state.researchId}:synthesis`;
  await e.node(
    insight,
    "insight",
    {
      label: "The answer combines several interacting factors",
      description: "Simulated synthesis: the branches point to linked causes rather than a single explanation.",
    },
    { confidence: 0.7 },
    [[insight, "explains", `${state.researchId}:root`]],
  );
  for (const b of state.branches) e.edge(`${b.branchId}:finding`, "supports", insight);
  e.write({ type: "phase", phase: "completed" });
  return {};
}

export const researchGraph = new StateGraph(ResearchState)
  .addNode("plan", plan)
  .addNode("researchBranch", researchBranch)
  .addNode("structure", structure)
  .addEdge(START, "plan")
  .addConditionalEdges("plan", (s: State) => s.branches.map((branch) => new Send("researchBranch", { ...s, branch })), [
    "researchBranch",
  ])
  .addEdge("researchBranch", "structure")
  .addEdge("structure", END)
  .compile();
