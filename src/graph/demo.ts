import { emptyBoard, mergeGraph, type BoardState } from "./board-state";
import type { EdgeRelation, GraphPatch, ResearchEdgeInput } from "./types";

/**
 * DEMO DATA — hand-written illustrative content, not produced by research.
 * Sources are named for context only; no URLs are included on purpose.
 */
export const DEMO_QUESTION = "What caused the 2008 financial crisis?";

const edge = (source: string, relation: EdgeRelation, target: string): ResearchEdgeInput => ({
  id: `${source}-${relation}-${target}`,
  source,
  target,
  data: { relation },
});

export const demoPatch: GraphPatch = {
  activity: "Loaded demo board: “What caused the 2008 financial crisis?”",
  nodes: [
    {
      id: "q-root",
      type: "question",
      data: {
        demo: true,
        label: DEMO_QUESTION,
        description: "Root question for this demo board.",
        status: "exploring",
      },
    },
    {
      id: "c-subprime",
      type: "claim",
      data: {
        demo: true,
        label: "Subprime mortgage lending expanded rapidly",
        description: "Loans were extended to borrowers with weak credit, often with low teaser rates.",
        confidence: 0.9,
      },
    },
    {
      id: "c-securitization",
      type: "claim",
      data: {
        demo: true,
        label: "Securitization spread mortgage risk through the system",
        description: "Mortgages were pooled into MBS and CDOs and sold to investors worldwide.",
        confidence: 0.85,
      },
    },
    {
      id: "c-policy",
      type: "claim",
      data: {
        demo: true,
        label: "Government housing policy was the primary driver",
        description: "A minority view that affordable-housing mandates pushed lending standards down.",
        confidence: 0.35,
        contested: true,
      },
    },
    {
      id: "c-leverage",
      type: "claim",
      data: {
        demo: true,
        label: "Major financial institutions were highly leveraged",
        description: "Thin capital buffers turned mortgage losses into solvency threats.",
        confidence: 0.85,
      },
    },
    {
      id: "e-housing",
      type: "evidence",
      data: {
        demo: true,
        label: "Home prices peaked around 2006, then fell sharply",
        description: "Falling prices removed refinancing options and defaults rose.",
        stance: "supporting",
      },
    },
    {
      id: "e-downgrades",
      type: "evidence",
      data: {
        demo: true,
        label: "AAA-rated mortgage securities were downgraded en masse",
        description: "Ratings had underestimated correlated default risk.",
        stance: "supporting",
      },
    },
    {
      id: "e-lehman",
      type: "evidence",
      data: {
        demo: true,
        label: "Lehman Brothers' collapse froze short-term funding",
        description: "September 2008: counterparties pulled back across the market.",
        stance: "supporting",
      },
    },
    {
      id: "e-private-lenders",
      type: "evidence",
      data: {
        demo: true,
        label: "Much high-risk lending came from private lenders",
        description: "Many subprime originators were not covered by the cited housing mandates.",
        stance: "conflicting",
      },
    },
    {
      id: "s-fcic",
      type: "source",
      data: {
        demo: true,
        label: "Financial Crisis Inquiry Commission Report",
        description: "Majority report of the U.S. commission investigating the crisis.",
        sourceType: "report",
        publisher: "FCIC",
        year: 2011,
      },
    },
    {
      id: "s-fcic-dissent",
      type: "source",
      data: {
        demo: true,
        label: "FCIC dissenting statement",
        description: "Dissent attributing the crisis mainly to housing policy.",
        sourceType: "report",
        publisher: "FCIC",
        year: 2011,
      },
    },
    {
      id: "i-interacting",
      type: "insight",
      data: {
        demo: true,
        label: "The crisis came from interacting failures, not one cause",
        description: "Risky lending, securitization and leverage amplified each other.",
        confidence: 0.8,
      },
    },
  ],
  edges: [
    edge("c-subprime", "explains", "q-root"),
    edge("c-securitization", "explains", "q-root"),
    edge("c-leverage", "explains", "q-root"),
    edge("c-policy", "related_to", "q-root"),
    edge("i-interacting", "explains", "q-root"),
    edge("c-securitization", "causes", "c-subprime"),
    edge("c-subprime", "supports", "i-interacting"),
    edge("c-leverage", "supports", "i-interacting"),
    edge("e-housing", "supports", "c-subprime"),
    edge("e-downgrades", "supports", "c-securitization"),
    edge("e-lehman", "supports", "c-leverage"),
    edge("e-private-lenders", "contradicts", "c-policy"),
    edge("e-housing", "sourced_from", "s-fcic"),
    edge("e-downgrades", "sourced_from", "s-fcic"),
    edge("e-private-lenders", "sourced_from", "s-fcic"),
    edge("c-policy", "sourced_from", "s-fcic-dissent"),
  ],
};

export function createDemoBoard(): BoardState {
  return mergeGraph({ ...emptyBoard, title: DEMO_QUESTION, isDemo: true }, demoPatch);
}
