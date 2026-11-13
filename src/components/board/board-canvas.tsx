"use client";

import { Background, Controls, ReactFlow } from "@xyflow/react";

import type { ResearchEdge, ResearchNode } from "@/graph/types";

// Placeholder canvas: verifies React Flow is wired up. The research board comes later.
const initialNodes: ResearchNode[] = [
  {
    id: "q-root",
    type: "question",
    position: { x: 0, y: 0 },
    data: { title: "Ask a research question to begin", status: "open" },
  },
];
const initialEdges: ResearchEdge[] = [];

export function BoardCanvas() {
  return (
    <ReactFlow
      defaultNodes={initialNodes}
      defaultEdges={initialEdges}
      fitView
      proOptions={{ hideAttribution: true }}
    >
      <Background />
      <Controls />
    </ReactFlow>
  );
}
