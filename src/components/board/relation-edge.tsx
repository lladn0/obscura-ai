"use client";

import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getStraightPath,
  Position,
  useInternalNode,
  type Edge,
  type EdgeProps,
  type InternalNode,
} from "@xyflow/react";
import { cn } from "@/lib/utils";

import { EDGE_RELATIONS, type ResearchEdgeData } from "@/graph/types";
import { STACK_INDENT } from "@/graph/layout";
import { useBoardView } from "./board-context";
import { RELATION_STYLES } from "./styles";

/** Render-only emphasis added by the canvas when a node is selected. */
export type DisplayEdge = Edge<ResearchEdgeData & { emphasis?: "focus" | "dim" }, "relation">;

function box(node: InternalNode) {
  const { x, y } = node.internals.positionAbsolute;
  const w = node.measured.width ?? 0;
  const h = node.measured.height ?? 0;
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
}

/** Point where the ray from the box centre towards (tx, ty) leaves the box. */
function borderPoint(b: ReturnType<typeof box>, tx: number, ty: number) {
  const dx = tx - b.cx;
  const dy = ty - b.cy;
  if (!dx && !dy) return { x: b.cx, y: b.cy };
  const scale = Math.min(
    dx ? b.w / 2 / Math.abs(dx) : Infinity,
    dy ? b.h / 2 / Math.abs(dy) : Infinity,
  );
  return { x: b.cx + dx * scale, y: b.cy + dy * scale };
}

/** Sun mode: straight spokes between the facing borders of the two cards. */
function radialPath(source: InternalNode, target: InternalNode): [string, number, number] {
  const s = box(source);
  const t = box(target);
  const a = borderPoint(s, t.cx, t.cy);
  const b = borderPoint(t, s.cx, s.cy);
  const [path, x, y] = getStraightPath({ sourceX: a.x, sourceY: a.y, targetX: b.x, targetY: b.y });
  return [path, x, y];
}

/**
 * Cross-links (edges that are not part of the tree) would cut straight through
 * the cards between their ends. In Sun mode they bow outward, away from the
 * centre; in Tree mode, links within one row arc over it.
 */
function crossLinkPath(source: InternalNode, target: InternalNode, mode: "sun" | "tree"): [string, number, number] | null {
  const s = box(source);
  const t = box(target);
  if (mode === "tree") {
    const sameRow = Math.abs(t.cy - s.cy) < (s.h + t.h) / 2;
    const apart = Math.abs(t.cx - s.cx) - (s.w + t.w) / 2;
    if (!sameRow || apart < 80) return null;
    const k = 36 + Math.abs(t.cx - s.cx) * 0.12;
    const top = Math.min(s.y, t.y);
    return [
      `M ${s.cx} ${s.y} C ${s.cx} ${top - k}, ${t.cx} ${top - k}, ${t.cx} ${t.y}`,
      (s.cx + t.cx) / 2,
      top - k * 0.75,
    ];
  }
  const a = borderPoint(s, t.cx, t.cy);
  const b = borderPoint(t, s.cx, s.cy);
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  // Push the control point away from the board centre (the root sits at the origin).
  let nx = mx;
  let ny = my;
  const d = Math.hypot(nx, ny);
  if (d < 1) [nx, ny] = [-(b.y - a.y), b.x - a.x];
  const n = Math.hypot(nx, ny) || 1;
  const cx = mx + (nx / n) * len * 0.3;
  const cy = my + (ny / n) * len * 0.3;
  return [`M ${a.x} ${a.y} Q ${cx} ${cy}, ${b.x} ${b.y}`, 0.25 * a.x + 0.5 * cx + 0.25 * b.x, 0.25 * a.y + 0.5 * cy + 0.25 * b.y];
}

/**
 * Tree mode, leaf children stacked in an indented column under their parent:
 * run down a spine on the parent's left edge, then across into the child, so
 * the line never crosses the siblings above it.
 */
function stackedPath(parent: InternalNode, child: InternalNode, parentIsSource: boolean): [string, number, number] | null {
  const p = box(parent);
  const c = box(child);
  const indent = c.x - p.x;
  if (indent < STACK_INDENT / 2 || indent > STACK_INDENT * 1.6 || c.y < p.y + p.h) return null;
  const spine = p.x + indent / 2;
  const r = Math.min(8, indent / 2);
  const down = `M ${spine} ${p.y + p.h} L ${spine} ${c.cy - r} Q ${spine} ${c.cy}, ${spine + r} ${c.cy} L ${c.x} ${c.cy}`;
  const up = `M ${c.x} ${c.cy} L ${spine + r} ${c.cy} Q ${spine} ${c.cy}, ${spine} ${c.cy - r} L ${spine} ${p.y + p.h}`;
  return [parentIsSource ? down : up, spine + (c.x - spine) / 2, c.cy];
}

/** Tree mode: leave from the bottom/top when the cards are on different levels, else from the sides. */
function treeParams(source: InternalNode, target: InternalNode) {
  const s = box(source);
  const t = box(target);
  const dx = t.cx - s.cx;
  const dy = t.cy - s.cy;

  if (Math.abs(dy) < (s.h + t.h) / 2) {
    const right = dx > 0;
    return {
      sourceX: right ? s.x + s.w : s.x,
      sourceY: s.cy,
      sourcePosition: right ? Position.Right : Position.Left,
      targetX: right ? t.x : t.x + t.w,
      targetY: t.cy,
      targetPosition: right ? Position.Left : Position.Right,
    };
  }
  const down = dy > 0;
  return {
    sourceX: s.cx,
    sourceY: down ? s.y + s.h : s.y,
    sourcePosition: down ? Position.Bottom : Position.Top,
    targetX: t.cx,
    targetY: down ? t.y : t.y + t.h,
    targetPosition: down ? Position.Top : Position.Bottom,
  };
}

export const RelationEdge = memo(function RelationEdge({
  id,
  source,
  target,
  data,
  selected,
}: EdgeProps<DisplayEdge>) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const { mode, hierarchy } = useBoardView();
  if (!sourceNode || !targetNode || !data) return null;

  const style = RELATION_STYLES[data.relation];
  const parentIsSource = hierarchy.parent.get(target) === source;
  const isTreeEdge = parentIsSource || hierarchy.parent.get(source) === target;
  const [path, labelX, labelY] =
    (isTreeEdge &&
      mode === "tree" &&
      (parentIsSource
        ? stackedPath(sourceNode, targetNode, true)
        : stackedPath(targetNode, sourceNode, false))) ||
    (!isTreeEdge && crossLinkPath(sourceNode, targetNode, mode)) ||
    (mode === "sun"
      ? radialPath(sourceNode, targetNode)
      : getBezierPath({ ...treeParams(sourceNode, targetNode), curvature: 0.35 }));
  const focus = selected || data.emphasis === "focus";
  const dim = data.emphasis === "dim";
  const resting = isTreeEdge ? 0.55 : 0.28;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        className="rh-edge-path"
        markerEnd={style.directed ? `url(#rh-arrow-${data.relation})` : undefined}
        interactionWidth={16}
        style={{
          stroke: style.color,
          strokeWidth: focus ? style.width + 0.8 : style.width,
          strokeDasharray: style.dash,
          strokeLinecap: "round",
          opacity: dim ? 0.1 : focus ? 1 : resting,
          transition: "opacity 200ms, stroke-width 200ms",
        }}
      />
      {style.flow && !dim && (
        <path d={path} className="rh-edge-flow" stroke={style.color} fill="none" />
      )}
      {/* Labels only on the focused branch, to keep the board calm. */}
      <EdgeLabelRenderer>
        <div
          className={cn(
            "nodrag nopan pointer-events-none absolute rounded-full border bg-background/90 px-1.5 py-px text-[10px] leading-4 font-medium backdrop-blur transition-opacity duration-200",
            focus ? "opacity-100" : "opacity-0",
          )}
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            color: style.color,
            borderColor: `${style.color}40`,
          }}
        >
          {data.label ?? style.label}
        </div>
      </EdgeLabelRenderer>
    </>
  );
});

/** Arrowhead definitions, one per relation colour. Render once inside the board. */
export function RelationMarkers() {
  return (
    <svg className="pointer-events-none absolute size-0" aria-hidden>
      <defs>
        {EDGE_RELATIONS.map((relation) => (
          <marker
            key={relation}
            id={`rh-arrow-${relation}`}
            viewBox="0 0 10 10"
            refX="8.5"
            refY="5"
            markerWidth="10"
            markerHeight="10"
            markerUnits="userSpaceOnUse"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 9 5 L 0 9 z" fill={RELATION_STYLES[relation].color} />
          </marker>
        ))}
      </defs>
    </svg>
  );
}

export const edgeTypes = { relation: RelationEdge };
