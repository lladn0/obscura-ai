import type { EdgeRelation, NodeKind } from "@/graph/types";

/**
 * Wire contract between the research agent and the board, carried over
 * official AG-UI events:
 *   RUN_STARTED / RUN_FINISHED / RUN_ERROR  run lifecycle
 *   STEP_STARTED / STEP_FINISHED            phases (planning, researching, structuring)
 *   STATE_SNAPSHOT / STATE_DELTA            ResearchState (phase + per-branch activity)
 *   CUSTOM                                  graph operations below
 * Every graph operation carries researchId, branchId and nodeId.
 */
export const RESEARCH_AGENT_ID = "research";

export type ResearchPhase = "planning" | "researching" | "structuring" | "completed" | "error";
export type BranchStatus = "queued" | "researching" | "done" | "error";

export type ResearchState = {
  researchId: string;
  question: string;
  phase: ResearchPhase;
  branches: Record<string, { label: string; status: BranchStatus }>;
};

export const GraphEvent = {
  NodeCreated: "graph.node.created",
  NodeText: "graph.node.text",
  NodeCompleted: "graph.node.completed",
  EdgeCreated: "graph.edge.created",
} as const;

type Ids = { researchId: string; branchId: string; nodeId: string };

export type NodeCreated = Ids & {
  kind: NodeKind;
  /** Non-text fields (confidence, stance, ...). Text arrives via NodeText. */
  data?: Record<string, unknown>;
  /** Start with this node's branch folded (e.g. a finding's evidence and sources). */
  collapsed?: boolean;
};
/** `seq` increases per node, so the client can keep order and drop duplicates. */
export type NodeText = Ids & { seq: number; field: "label" | "description"; delta: string };
/** `data` is the schema-validated final content; it replaces the provisional streamed text. */
export type NodeCompleted = Ids & { data?: Record<string, unknown> };
export type EdgeCreated = Omit<Ids, "nodeId"> & {
  edgeId: string;
  source: string;
  target: string;
  relation: EdgeRelation;
};

export type GraphEventPayload =
  | { name: typeof GraphEvent.NodeCreated; value: NodeCreated }
  | { name: typeof GraphEvent.NodeText; value: NodeText }
  | { name: typeof GraphEvent.NodeCompleted; value: NodeCompleted }
  | { name: typeof GraphEvent.EdgeCreated; value: EdgeCreated };

/** CUSTOM event carrying per-request cost accounting (ResearchUsage in graph.ts). */
export const USAGE_EVENT = "research.usage";

/** Input forwarded from the client with each run. */
export type ResearchRunProps = { question: string; researchId: string };
