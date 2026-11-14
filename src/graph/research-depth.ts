import type { NodeKind } from "./types";

/**
 * Research depth is the investigation hierarchy, not the visual graph depth:
 *   0  main research question
 *   1  primary research directions
 *   2  findings and subtopics within those directions
 *   3+ levels the user opened with Deep Dive (one level per request)
 *
 * Automatic research (Stage 4) stops at MAX_AUTO_DEPTH; there is no global cap
 * on user-initiated Deep Dives.
 */
export const MAX_AUTO_DEPTH = 2;

/**
 * Supporting material attaches to a research node without opening a new level
 * of investigation, so it never consumes the depth allowance.
 */
export const SUPPORTING_KINDS: ReadonlySet<NodeKind> = new Set(["evidence", "source"]);

export const consumesDepth = (kind: NodeKind) => !SUPPORTING_KINDS.has(kind);

export function describeDepth(depth: number, kind: NodeKind): string {
  if (!consumesDepth(kind)) return `Supporting material · level ${depth}`;
  if (depth === 0) return "Main research question";
  if (depth === 1) return "Primary research direction";
  if (depth === 2) return "Finding / subtopic";
  return `Deep dive · level ${depth}`;
}
