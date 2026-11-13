import dagre from "@dagrejs/dagre";
import type { XYPosition } from "@xyflow/react";

import type { NodeKind, ResearchEdge, ResearchNode } from "./types";

export const NODE_WIDTH: Record<NodeKind, number> = {
  question: 300,
  claim: 260,
  evidence: 260,
  source: 230,
  insight: 280,
};

/** Used before React Flow has measured a node. */
const ESTIMATED_HEIGHT: Record<NodeKind, number> = {
  question: 110,
  claim: 150,
  evidence: 140,
  source: 100,
  insight: 150,
};

/** Column order left -> right: questions + insights (answers), claims, evidence, sources. */
const KIND_RANK: Record<NodeKind, number> = {
  question: 0,
  insight: 0,
  claim: 1,
  evidence: 2,
  source: 3,
};

function size(node: ResearchNode) {
  return {
    width: node.measured?.width ?? NODE_WIDTH[node.type],
    height: node.measured?.height ?? ESTIMATED_HEIGHT[node.type],
  };
}

/**
 * Layered left-to-right layout. Edges are oriented by node kind (not by
 * semantic direction) so the board always reads question -> claims -> evidence -> sources.
 */
export function computeLayout(
  nodes: ResearchNode[],
  edges: ResearchEdge[],
): Map<string, XYPosition> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 90, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));

  const kindOf = new Map(nodes.map((n) => [n.id, n.type]));
  for (const node of nodes) g.setNode(node.id, size(node));

  for (const edge of edges) {
    const a = kindOf.get(edge.source);
    const b = kindOf.get(edge.target);
    if (!a || !b) continue;
    // Same-column edges (e.g. claim causes claim) must not push nodes into a new column.
    if (KIND_RANK[a] === KIND_RANK[b]) continue;
    const reversed = KIND_RANK[a] > KIND_RANK[b];
    g.setEdge(reversed ? edge.target : edge.source, reversed ? edge.source : edge.target);
  }

  dagre.layout(g);

  const positions = new Map<string, XYPosition>();
  for (const node of nodes) {
    const { x, y, width, height } = g.node(node.id);
    positions.set(node.id, { x: x - width / 2, y: y - height / 2 });
  }
  return positions;
}

/**
 * Positions only the nodes in `newIds`, leaving every other node where it is
 * (including manually dragged ones). Each new node keeps its layout offset
 * relative to an already-placed neighbour.
 */
export function placeNewNodes(
  nodes: ResearchNode[],
  edges: ResearchEdge[],
  newIds: Set<string>,
): ResearchNode[] {
  const layout = computeLayout(nodes, edges);
  const placed = new Map<string, XYPosition>();
  for (const n of nodes) if (!newIds.has(n.id)) placed.set(n.id, n.position);

  // No existing nodes: the fresh layout is the answer.
  if (placed.size === 0) {
    return nodes.map((n) => ({ ...n, position: layout.get(n.id)! }));
  }

  const pending = new Set(newIds);
  let progressed = true;
  while (pending.size && progressed) {
    progressed = false;
    for (const id of pending) {
      const anchorId = edges
        .map((e) => (e.source === id ? e.target : e.target === id ? e.source : null))
        .find((other): other is string => !!other && placed.has(other));
      if (!anchorId) continue;
      const anchor = placed.get(anchorId)!;
      const from = layout.get(anchorId)!;
      const to = layout.get(id)!;
      placed.set(id, { x: anchor.x + to.x - from.x, y: anchor.y + to.y - from.y });
      pending.delete(id);
      progressed = true;
    }
  }

  // Disconnected newcomers go in a row below the existing board.
  if (pending.size) {
    const existing = [...placed.values()];
    const minX = Math.min(...existing.map((p) => p.x));
    const maxY = Math.max(...existing.map((p) => p.y));
    let x = minX;
    for (const id of pending) {
      placed.set(id, { x, y: maxY + 180 });
      x += 340;
    }
  }

  return nodes.map((n) => (newIds.has(n.id) ? { ...n, position: placed.get(n.id)! } : n));
}
