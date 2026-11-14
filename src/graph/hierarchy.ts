import type { ResearchEdge, ResearchNode } from "./types";

/**
 * A spanning tree derived from the knowledge graph, used for layout,
 * collapsing and branch highlighting. The graph itself is never modified:
 * cross-links (e.g. two evidence nodes citing one source) stay as edges,
 * they just don't define the tree.
 */
export type Hierarchy = {
  rootId: string | null;
  parent: Map<string, string | null>;
  children: Map<string, string[]>;
  depth: Map<string, number>;
};

export function buildHierarchy(
  nodes: Pick<ResearchNode, "id" | "type">[],
  edges: Pick<ResearchEdge, "source" | "target">[],
): Hierarchy {
  const parent = new Map<string, string | null>();
  const children = new Map<string, string[]>();
  const depth = new Map<string, number>();
  for (const n of nodes) children.set(n.id, []);

  const adjacent = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (!adjacent.has(e.source) || !adjacent.has(e.target)) continue;
    adjacent.get(e.source)!.push(e.target);
    adjacent.get(e.target)!.push(e.source);
  }

  const root = nodes.find((n) => n.type === "question") ?? nodes[0];
  if (!root) return { rootId: null, parent, children, depth };

  const bfs = (start: string, attachTo: string | null, startDepth: number) => {
    parent.set(start, attachTo);
    depth.set(start, startDepth);
    if (attachTo) children.get(attachTo)!.push(start);
    const queue = [start];
    while (queue.length) {
      const id = queue.shift()!;
      for (const next of adjacent.get(id)!) {
        if (parent.has(next)) continue;
        parent.set(next, id);
        depth.set(next, depth.get(id)! + 1);
        children.get(id)!.push(next);
        queue.push(next);
      }
    }
  };

  bfs(root.id, null, 0);
  // Disconnected pieces (e.g. a freshly added question) hang off the root as
  // their own branch. Questions are preferred as the branch head.
  const rest = [...nodes].sort((a, b) => Number(b.type === "question") - Number(a.type === "question"));
  for (const n of rest) if (!parent.has(n.id)) bfs(n.id, root.id, 1);

  return { rootId: root.id, parent, children, depth };
}

/** Ids reachable from the root without descending into collapsed nodes. */
export function visibleIds(h: Hierarchy, collapsed: ReadonlySet<string>): Set<string> {
  const visible = new Set<string>();
  if (!h.rootId) return visible;
  const stack = [h.rootId];
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

/** Sensible default: the question and its main branches, deeper levels folded. */
export function defaultCollapsed(h: Hierarchy): string[] {
  return [...h.depth]
    .filter(([id, d]) => d === 1 && h.children.get(id)!.length > 0)
    .map(([id]) => id);
}
