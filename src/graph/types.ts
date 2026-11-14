import type { Edge, Node, XYPosition } from "@xyflow/react";

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
  "insight",
  "note",
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const EDGE_RELATIONS = [
  "supports", // evidence/claim -> claim/insight
  "contradicts", // evidence/claim -> claim/insight
  "causes", // claim -> claim (causal chain)
  "explains", // claim/insight -> question
  "sourced_from", // claim/evidence -> source
  "related_to", // any <-> any (undirected)
] as const;
export type EdgeRelation = (typeof EDGE_RELATIONS)[number];

/** 0..1 */
export type Confidence = number;

type BaseNodeData = {
  label: string;
  description?: string;
  /** Illustrative content that was not produced by research. */
  demo?: boolean;
  /** True while an agent is still streaming this node's text. */
  generating?: boolean;
  researchId?: string;
  branchId?: string;
  /** The user edited label/description: later AI updates must not overwrite them. */
  userEdited?: boolean;
  /** Optional contextual image (chosen by the AI, retrieved from Wikimedia Commons). */
  imageNeeded?: boolean;
  imageQuery?: string;
  imageUrl?: string;
  imageAlt?: string;
  /** Page of the image on its host (attribution + licence). */
  imageSourceUrl?: string;
  imageCredit?: string;
  imageStatus?: "pending" | "loading" | "ready" | "none";
};

/** Image fields shared by every node kind. */
export type ImageFields = Pick<
  BaseNodeData,
  "imageNeeded" | "imageQuery" | "imageUrl" | "imageAlt" | "imageSourceUrl" | "imageCredit" | "imageStatus"
>;

export type QuestionData = BaseNodeData & {
  status?: "open" | "exploring" | "answered";
  /** Set on questions suggested by Research Gaps. */
  gap?: "unanswered" | "missing-evidence" | "overlooked";
  /** Extra instructions from the user, used for later research on this question. */
  context?: string;
};

export type Verification = "verified" | "unverified" | "contested";

export type ClaimData = BaseNodeData & {
  confidence?: Confidence;
  contested?: boolean;
  /** Critic's verdict on whether the cited sources back this claim. */
  verification?: Verification;
  /** Ids of the source nodes this claim cites. */
  sourceIds?: string[];
  /** Set on counterpoints found by Challenge: a real contradiction or a competing perspective. */
  challenge?: "contradiction" | "alternative";
};

export type EvidenceData = BaseNodeData & {
  stance?: "supporting" | "conflicting" | "neutral";
  quote?: string;
};

export type SourceData = BaseNodeData & {
  sourceType?: "webpage" | "article" | "paper" | "report";
  publisher?: string;
  year?: number;
  url?: string;
};

export type InsightData = BaseNodeData & {
  confidence?: Confidence;
};

/** A user-created sticky note: free-floating, outside the research hierarchy. */
export type NoteData = BaseNodeData;

export type QuestionNode = Node<QuestionData, "question">;
export type ClaimNode = Node<ClaimData, "claim">;
export type EvidenceNode = Node<EvidenceData, "evidence">;
export type SourceNode = Node<SourceData, "source">;
export type InsightNode = Node<InsightData, "insight">;
export type NoteNode = Node<NoteData, "note">;

export type ResearchNode =
  | QuestionNode
  | ClaimNode
  | EvidenceNode
  | SourceNode
  | InsightNode
  | NoteNode;

export type ResearchEdgeData = {
  relation: EdgeRelation;
  label?: string;
  strength?: Confidence;
  /** Drawn by the user: a visual link only, never part of the research hierarchy. */
  manual?: boolean;
};

/** All research edges render through the single custom "relation" edge. */
export type ResearchEdge = Edge<ResearchEdgeData, "relation">;

/** A node as producers (demo data, future agents) supply it: position is optional. */
export type ResearchNodeInput = ResearchNode extends infer N
  ? N extends ResearchNode
    ? Omit<N, "position"> & { position?: XYPosition }
    : never
  : never;

export type ResearchEdgeInput = Omit<ResearchEdge, "type"> & {
  type?: "relation";
};

/**
 * Incremental update to a board. Existing nodes are matched by id and their
 * data merged; their positions are never touched. New nodes without a position
 * are placed automatically next to the nodes they connect to.
 */
export type GraphPatch = {
  nodes?: ResearchNodeInput[];
  edges?: ResearchEdgeInput[];
  /** Optional activity-log message describing the update. */
  activity?: string;
};
