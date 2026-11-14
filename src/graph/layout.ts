import dagre from "@dagrejs/dagre";
import type { XYPosition } from "@xyflow/react";

import type { Hierarchy } from "./hierarchy";
import type { NodeKind, ResearchNode } from "./types";

export const LAYOUT_MODES = ["sun", "tree"] as const;
export type LayoutMode = (typeof LAYOUT_MODES)[number];

export const NODE_WIDTH: Record<NodeKind, number> = {
  question: 260,
  claim: 230,
  evidence: 230,
  source: 210,
  insight: 240,
};

/** Used before React Flow has measured a node. */
const ESTIMATED_HEIGHT: Record<NodeKind, number> = {
  question: 84,
  claim: 96,
  evidence: 84,
  source: 84,
  insight: 96,
};

type Size = { width: number; height: number };

function sizeOf(node: ResearchNode): Size {
  return {
    width: node.measured?.width ?? NODE_WIDTH[node.type],
    height: node.measured?.height ?? ESTIMATED_HEIGHT[node.type],
  };
}

/**
 * Auto-layout positions (top-left corners) for the visible part of the
 * hierarchy. Hidden (collapsed) nodes are left out.
 */
export function computeLayout(
  mode: LayoutMode,
  nodes: ResearchNode[],
  h: Hierarchy,
  visible: Set<string>,
): Map<string, XYPosition> {
  const sizes = new Map<string, Size>();
  for (const n of nodes) if (visible.has(n.id)) sizes.set(n.id, sizeOf(n));
  if (!h.rootId || !sizes.size) return new Map();
  return mode === "sun" ? sunLayout(h, sizes) : treeLayout(h, sizes);
}

// --- Tree: top-to-bottom hierarchy (dagre) ---------------------------------

function treeLayout(h: Hierarchy, sizes: Map<string, Size>): Map<string, XYPosition> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 28, ranksep: 72, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const [id, size] of sizes) g.setNode(id, size);
  // Only tree edges drive the layout, so siblings stay grouped under their parent.
  for (const id of sizes.keys()) {
    const parent = h.parent.get(id);
    if (parent && sizes.has(parent)) g.setEdge(parent, id);
  }
  dagre.layout(g);

  const positions = new Map<string, XYPosition>();
  for (const [id, { width, height }] of sizes) {
    const { x, y } = g.node(id);
    positions.set(id, { x: x - width / 2, y: y - height / 2 });
  }
  return positions;
}

// --- Sun: radial tree -------------------------------------------------------

const GAP_X = 28;
const GAP_Y = 22;
const MIN_FIRST_RING = 280;
const EDGE_ROOM = 70;

/** Centre distance two cards need along unit direction (ux, uy) to not overlap. */
function clearance(a: Size, b: Size, ux: number, uy: number) {
  const w = (a.width + b.width) / 2 + GAP_X;
  const hgt = (a.height + b.height) / 2 + GAP_Y;
  const ax = Math.abs(ux);
  const ay = Math.abs(uy);
  return Math.min(ax > 1e-6 ? w / ax : Infinity, ay > 1e-6 ? hgt / ay : Infinity);
}

/**
 * Each node gets an angular wedge proportional to its number of visible
 * leaves, nested inside its parent's wedge, so branches never interleave.
 * Ring radii then grow just enough that neighbouring cards on a ring, and
 * cards on consecutive rings, clear each other.
 */
function sunLayout(h: Hierarchy, sizes: Map<string, Size>): Map<string, XYPosition> {
  const root = h.rootId!;
  const kids = (id: string) => h.children.get(id)!.filter((c) => sizes.has(c));

  const weight = new Map<string, number>();
  const measure = (id: string): number => {
    const k = kids(id);
    const w = k.length ? k.reduce((sum, c) => sum + measure(c), 0) : 1;
    weight.set(id, w);
    return w;
  };
  measure(root);

  const angle = new Map<string, number>();
  const rings: string[][] = [];
  const assign = (id: string, from: number, to: number, depth: number) => {
    angle.set(id, (from + to) / 2);
    if (depth > 0) (rings[depth] ??= []).push(id);
    let cursor = from;
    for (const c of kids(id)) {
      const span = ((to - from) * weight.get(c)!) / weight.get(id)!;
      assign(c, cursor, cursor + span, depth + 1);
      cursor += span;
    }
  };
  // Centre the first branch at 12 o'clock.
  const first = kids(root)[0];
  const offset = first ? (Math.PI * weight.get(first)!) / weight.get(root)! : 0;
  assign(root, -Math.PI / 2 - offset, (3 * Math.PI) / 2 - offset, 0);

  const radius = new Map<number, number>([[0, 0]]);
  const rootSize = sizes.get(root)!;
  for (let d = 1; d < rings.length; d++) {
    const ring = rings[d] ?? [];
    let r = d === 1 ? MIN_FIRST_RING : 0;

    // Clear the previous ring (or the root card) along each node's own ray.
    for (const id of ring) {
      const a = angle.get(id)!;
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      const inner = d === 1 ? rootSize : maxSize(rings[d - 1], sizes);
      r = Math.max(r, radius.get(d - 1)! + clearance(inner, sizes.get(id)!, ux, uy) + EDGE_ROOM);
    }

    // Neighbours on the same ring must not overlap (chord between them).
    const sorted = [...ring].sort((a, b) => angle.get(a)! - angle.get(b)!);
    for (let i = 0; i < sorted.length && sorted.length > 1; i++) {
      const a = sorted[i];
      const b = sorted[(i + 1) % sorted.length];
      let gap = angle.get(b)! - angle.get(a)!;
      if (gap <= 0) gap += 2 * Math.PI;
      if (gap >= Math.PI) continue;
      const mid = angle.get(a)! + gap / 2;
      // Chord direction is tangential at the midpoint.
      const need = clearance(sizes.get(a)!, sizes.get(b)!, -Math.sin(mid), Math.cos(mid));
      r = Math.max(r, need / (2 * Math.sin(gap / 2)));
    }
    radius.set(d, r);
  }

  const positions = new Map<string, XYPosition>();
  const place = (id: string, depth: number) => {
    const { width, height } = sizes.get(id)!;
    const r = radius.get(depth)!;
    const a = angle.get(id)!;
    positions.set(id, { x: r * Math.cos(a) - width / 2, y: r * Math.sin(a) - height / 2 });
    for (const c of kids(id)) place(c, depth + 1);
  };
  place(root, 0);
  return positions;
}

function maxSize(ids: string[] | undefined, sizes: Map<string, Size>): Size {
  let width = 0;
  let height = 0;
  for (const id of ids ?? []) {
    const s = sizes.get(id)!;
    width = Math.max(width, s.width);
    height = Math.max(height, s.height);
  }
  return { width, height };
}
