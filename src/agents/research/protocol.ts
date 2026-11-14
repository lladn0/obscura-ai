import type { EdgeRelation, NodeKind, Verification } from "@/graph/types";

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
  /** A provisional node that failed validation; its edges go with it. */
  NodeRemoved: "graph.node.removed",
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
  | { name: typeof GraphEvent.EdgeCreated; value: EdgeCreated }
  | { name: typeof GraphEvent.NodeRemoved; value: Ids };

/** CUSTOM event carrying per-request cost accounting (ResearchUsage in graph.ts). */
export const USAGE_EVENT = "research.usage";

/** User-initiated investigations of one node. */
export type NodeAction = "deepDive" | "challenge" | "findEvidence" | "gaps" | "followUp";

/** Compact context about the node being investigated (the server keeps no board state). */
export type ActionTarget = {
  id: string;
  kind: NodeKind;
  label: string;
  description?: string;
  verification?: Verification;
  /** Labels from the root question down to the node's parent. */
  path: string[];
  /** Labels of the node's existing children, to avoid duplicates. */
  children: string[];
  /** For gap analysis: the selected branch's nodes with their status. */
  branch?: { label: string; kind: NodeKind; verification?: Verification }[];
  /** User guidance attached to this node and its ancestors ("focus on the Lithuanian event"). */
  context?: string[];
  /** Follow-up questions: the existing question the new one is asked under. */
  parentId?: string;
};

export type ActionRequest = {
  kind: NodeAction;
  actionId: string;
  target: ActionTarget;
  /** Source URL -> existing source node id, so citations reuse board nodes. */
  knownSources: Record<string, string>;
};

/** CUSTOM event summarising what an action found (or why it added nothing). */
export const ACTION_RESULT_EVENT = "research.action.result";
export type ActionResult = { actionId: string; nodeId: string; kind: NodeAction; message: string; added: number };

/** Input forwarded from the client with each run: a new question, or an action on a node. */
export type ResearchRunProps = { question: string; researchId: string; action?: ActionRequest };
