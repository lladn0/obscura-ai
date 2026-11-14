import { consumesDepth } from "./research-depth";
import type { ResearchEdge, ResearchNode } from "./types";

/**
 * A spanning tree derived from the knowledge graph, used for layout,
 * collapsing and branch highlighting. The graph itself is never modified:
 * cross-links (e.g. two evidence nodes citing one source) stay as edges,
 * they just don't define the tree.
 */
export type Hierarchy = {
  /** First root (kept for callers that only need one). */
  rootId: string | null;
  /** Every independent tree: one per research question (plus detached pieces). */
  roots: string[];
  parent: Map<string, string | null>;
  children: Map<string, string[]>;
  /** Visual tree depth within its own tree (drives layout rings/rows and default folding). */
  depth: Map<string, number>;
  /**
   * Investigation depth: evidence and sources inherit their parent's level
   * instead of adding one (see research-depth.ts).
   */
  researchDepth: Map<string, number>;
};

/**
 * Explicit parent links from edge semantics, in arrival order. Research edges
 * point child -> parent (a finding `supports` its direction, a direction
 * `explains` the question), except `sourced_from`, where the cited source
 * belongs under the first node that cited it. A node keeps the first parent it
 * gets, so later cross-links (contradicts, shared sources, links between
 * research trees) never move it or merge two trees.
 *
 * User notes and user-drawn connections are free-floating canvas objects:
 * they never take part in the hierarchy.
 */
export function buildHierarchy(
  allNodes: Pick<ResearchNode, "id" | "type">[],
  allEdges: Pick<ResearchEdge, "source" | "target" | "data">[],
): Hierarchy {
  const nodes = allNodes.filter((n) => n.type !== "note");
  const kind = new Map(nodes.map((n) => [n.id, n.type]));
  const parent = new Map<string, string | null>();
  const children = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  const depth = new Map<string, number>();
  const researchDepth = new Map<string, number>();

  const parentOf = new Map<string, string>();
  const isAncestor = (a: string, of: string) => {
    for (let p: string | undefined = of; p; p = parentOf.get(p)) if (p === a) return true;
    return false;
  };
  for (const e of allEdges) {
    if (e.data?.manual || !kind.has(e.source) || !kind.has(e.target) || e.source === e.target) continue;
    const [child, par] = e.data?.relation === "sourced_from" ? [e.target, e.source] : [e.source, e.target];
    // Research questions head their own tree; only follow-ups (explicitly linked) hang below one.
    if (parentOf.has(child) || isAncestor(child, par)) continue;
    parentOf.set(child, par);
  }

  // Roots in board order, research questions first.
  const roots = nodes
    .filter((n) => !parentOf.has(n.id))
    .sort((a, b) => Number(b.type === "question") - Number(a.type === "question"))
    .map((n) => n.id);
  for (const [child, par] of parentOf) children.get(par)!.push(child);

  for (const root of roots) {
    parent.set(root, null);
    depth.set(root, 0);
    researchDepth.set(root, 0);
    const stack = [root];
    while (stack.length) {
      const id = stack.pop()!;
      for (const c of children.get(id)!) {
        parent.set(c, id);
        depth.set(c, depth.get(id)! + 1);
        researchDepth.set(c, researchDepth.get(id)! + (consumesDepth(kind.get(c)!) ? 1 : 0));
        stack.push(c);
      }
    }
  }

  return { rootId: roots[0] ?? null, roots, parent, children, depth, researchDepth };
}

/** Ids reachable from any root without descending into collapsed nodes. */
export function visibleIds(h: Hierarchy, collapsed: ReadonlySet<string>): Set<string> {
  const visible = new Set<string>();
  const stack = [...h.roots];
  while (stack.length) {
    const id = stack.pop()!;
    visible.add(id);
    if (!collapsed.has(id)) stack.push(...h.children.get(id)!);
  }
  return visible;
}

export function descendants(h: Hierarchy, id: string): string[] {
  const out: string[] = [];
  const stack = [...(h.children.get(id) ?? [])];
  while (stack.length) {
    const next = stack.pop()!;
    out.push(next);
    stack.push(...h.children.get(next)!);
  }
  return out;
}

export function ancestors(h: Hierarchy, id: string): string[] {
  const out: string[] = [];
  for (let p = h.parent.get(id); p; p = h.parent.get(p)) out.push(p);
  return out;
}

/** Sensible default: every tree's question and its main branches, deeper levels folded. */
export function defaultCollapsed(h: Hierarchy): string[] {
  return [...h.depth]
    .filter(([id, d]) => d === 1 && h.children.get(id)!.length > 0)
    .map(([id]) => id);
}
