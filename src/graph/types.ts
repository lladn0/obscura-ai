import type { Edge, Node } from "@xyflow/react";

/**
 * Knowledge-graph model for a research board.
 * Node/edge data use `type` aliases (not interfaces) so they satisfy
 * React Flow's `Record<string, unknown>` constraint.
 */

export const NODE_KINDS = [
  "question",
  "claim",
  "evidence",
  "source",
  "conclusion",
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const EDGE_RELATIONS = [
  "supports", // evidence/claim -> claim/conclusion
  "contradicts", // evidence/claim -> claim/conclusion
  "cites", // evidence/claim -> source
  "raises", // any -> question (follow-up / rabbit hole)
  "answers", // claim/conclusion -> question
] as const;
export type EdgeRelation = (typeof EDGE_RELATIONS)[number];

/** 0..1 */
export type Confidence = number;

type BaseNodeData = {
  title: string;
  summary?: string;
};

export type QuestionData = BaseNodeData & {
  status: "open" | "exploring" | "answered";
};

export type ClaimData = BaseNodeData & {
  confidence: Confidence;
};

export type EvidenceData = BaseNodeData & {
  quote?: string;
};

export type SourceData = BaseNodeData & {
  url: string;
  domain?: string;
  publishedAt?: string; // ISO date
  credibility?: Confidence;
};

export type ConclusionData = BaseNodeData & {
  confidence: Confidence;
};

export type QuestionNode = Node<QuestionData, "question">;
export type ClaimNode = Node<ClaimData, "claim">;
export type EvidenceNode = Node<EvidenceData, "evidence">;
export type SourceNode = Node<SourceData, "source">;
export type ConclusionNode = Node<ConclusionData, "conclusion">;

export type ResearchNode =
  | QuestionNode
  | ClaimNode
  | EvidenceNode
  | SourceNode
  | ConclusionNode;

export type ResearchEdgeData = {
  relation: EdgeRelation;
  label?: string;
  strength?: Confidence;
};

export type ResearchEdge = Edge<ResearchEdgeData>;

export type ResearchGraph = {
  question: string;
  nodes: ResearchNode[];
  edges: ResearchEdge[];
};
