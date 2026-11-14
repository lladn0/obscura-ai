import type { XYPosition } from "@xyflow/react";

import type { Hierarchy } from "./hierarchy";
import type { NodeKind, ResearchNode } from "./types";

export const LAYOUT_MODES = ["sun", "tree"] as const;
export type LayoutMode = (typeof LAYOUT_MODES)[number];

export const NODE_WIDTH: Record<NodeKind, number> = {
  question: 240,
  claim: 210,
  evidence: 210,
  source: 190,
  insight: 230,
  note: 220,
};

/** Used before React Flow has measured a node. */
const ESTIMATED_HEIGHT: Record<NodeKind, number> = {
  question: 84,
  claim: 96,
  evidence: 84,
  source: 84,
  insight: 96,
  note: 80,
};

type Size = { width: number; height: number };

export function sizeOf(node: ResearchNode): Size {
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
  if (!h.roots.length || !sizes.size) return new Map();
  // Each research tree is laid out on its own, then trees sit side by side;
  // the first tree keeps its place so new research never shifts it.
  const all = new Map<string, XYPosition>();
  let right = -Infinity;
  for (const root of h.roots) {
    if (!sizes.has(root)) continue;
    const tree = mode === "sun" ? sunLayout(h, sizes, root) : treeLayout(h, sizes, root);
    let minX = Infinity;
    let maxX = -Infinity;
    for (const [id, p] of tree) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x + sizes.get(id)!.width);
    }
    const dx = right === -Infinity ? 0 : right + TREE_GAP - minX;
    for (const [id, p] of tree) all.set(id, { x: p.x + dx, y: p.y });
    right = maxX + dx;
  }
  return all;
}

const TREE_GAP = 160;

// --- Tree: compact top-to-bottom hierarchy -----------------------------------

const H_GAP = 28;
const V_GAP = 64;
/** Leaf children stack in an indented column under their parent (like a file tree). */
export const STACK_INDENT = 28;
const STACK_GAP = 14;

type SubtreeBox = { w: number; h: number; stacked: boolean };

/**
 * Tidy tree: a node's subtrees sit side by side under it, except that a node
 * whose visible children are all leaves stacks them vertically. Research
 * branches end in many leaf findings, so this keeps the board narrow.
 */
function treeLayout(h: Hierarchy, sizes: Map<string, Size>, root: string): Map<string, XYPosition> {
  const kids = (id: string) => h.children.get(id)!.filter((c) => sizes.has(c));
  const boxes = new Map<string, SubtreeBox>();

  const measure = (id: string): SubtreeBox => {
    const own = sizes.get(id)!;
    const children = kids(id);
    let box: SubtreeBox;
    if (!children.length) box = { w: own.width, h: own.height, stacked: false };
    else if (children.every((c) => !kids(c).length)) {
      const heights = children.reduce((sum, c) => sum + sizes.get(c)!.height + STACK_GAP, 0);
      const widest = Math.max(...children.map((c) => sizes.get(c)!.width));
      box = { w: Math.max(own.width, STACK_INDENT + widest), h: own.height + STACK_GAP + heights, stacked: true };
    } else {
      const subs = children.map(measure);
      const row = subs.reduce((sum, s) => sum + s.w, 0) + H_GAP * (subs.length - 1);
      box = { w: Math.max(own.width, row), h: own.height + V_GAP + Math.max(...subs.map((s) => s.h)), stacked: false };
    }
    boxes.set(id, box);
    return box;
  };

  const positions = new Map<string, XYPosition>();
  const place = (id: string, left: number, top: number) => {
    const own = sizes.get(id)!;
    const box = boxes.get(id)!;
    const children = kids(id);
    if (box.stacked) {
      positions.set(id, { x: left, y: top });
      let y = top + own.height + STACK_GAP;
      for (const c of children) {
        positions.set(c, { x: left + STACK_INDENT, y });
        y += sizes.get(c)!.height + STACK_GAP;
      }
      return;
    }
    positions.set(id, { x: left + (box.w - own.width) / 2, y: top });
    if (!children.length) return;
    const row = children.reduce((sum, c) => sum + boxes.get(c)!.w, 0) + H_GAP * (children.length - 1);
    let x = left + (box.w - row) / 2;
    for (const c of children) {
      place(c, x, top + own.height + V_GAP);
      x += boxes.get(c)!.w + H_GAP;
    }
  };

  const rootBox = measure(root);
  place(root, -rootBox.w / 2, 0);
  return positions;
}

// --- Sun: radial tree -------------------------------------------------------

const GAP_X = 20;
const GAP_Y = 16;
const MIN_FIRST_RING = 240;
const RING_STEP = 150;

type Rect = { x: number; y: number; w: number; h: number };
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w + GAP_X && b.x < a.x + a.w + GAP_X && a.y < b.y + b.h + GAP_Y && b.y < a.y + a.h + GAP_Y;

/**
 * Each node gets an angular wedge proportional to its number of visible
 * leaves, nested inside its parent's wedge, so branches never interleave.
 * Rings are then placed card by card, each at the smallest radius (beyond its
 * parent) where it clears every card already placed.
 */
function sunLayout(h: Hierarchy, sizes: Map<string, Size>, root: string): Map<string, XYPosition> {
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

  const rootSize = sizes.get(root)!;
  const positions = new Map<string, XYPosition>([[root, { x: -rootSize.width / 2, y: -rootSize.height / 2 }]]);
  const placed: Rect[] = [{ x: -rootSize.width / 2, y: -rootSize.height / 2, w: rootSize.width, h: rootSize.height }];

  // Each card moves outward only as far as it must to clear everything already
  // placed: crowded sectors grow, sparse ones stay close to the centre.
  let prevInner = 0;
  for (let d = 1; d < rings.length; d++) {
    const ring = [...(rings[d] ?? [])].sort((a, b) => angle.get(a)! - angle.get(b)!);
    let ringMin = Infinity;
    for (const id of ring) {
      const { width, height } = sizes.get(id)!;
      const a = angle.get(id)!;
      const parent = h.parent.get(id)!;
      const pp = positions.get(parent)!;
      const ps = sizes.get(parent)!;
      // Start just beyond the parent (and the previous ring's inner edge).
      const parentR = Math.hypot(pp.x + ps.width / 2, pp.y + ps.height / 2);
      let r = Math.max(d === 1 ? MIN_FIRST_RING : 0, parentR + RING_STEP, prevInner + RING_STEP);
      const rectAt = (radius: number): Rect => ({
        x: radius * Math.cos(a) - width / 2,
        y: radius * Math.sin(a) - height / 2,
        w: width,
        h: height,
      });
      let rect = rectAt(r);
      for (let i = 0; i < 200 && placed.some((b) => overlaps(rect, b)); i++) rect = rectAt((r += 10));
      positions.set(id, { x: rect.x, y: rect.y });
      placed.push(rect);
      ringMin = Math.min(ringMin, r);
    }
    prevInner = ringMin;
  }
  return positions;
}
