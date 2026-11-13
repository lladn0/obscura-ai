"use client";

import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  Position,
  useInternalNode,
  type Edge,
  type EdgeProps,
  type InternalNode,
} from "@xyflow/react";
import { cn } from "@/lib/utils";

import { EDGE_RELATIONS, type ResearchEdgeData } from "@/graph/types";
import { RELATION_STYLES } from "./styles";

/** Render-only emphasis added by the canvas when a node is selected. */
export type DisplayEdge = Edge<ResearchEdgeData & { emphasis?: "focus" | "dim" }, "relation">;

function box(node: InternalNode) {
  const { x, y } = node.internals.positionAbsolute;
  const w = node.measured.width ?? 0;
  const h = node.measured.height ?? 0;
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
}

/**
 * Nodes stacked in the same column with other cards between them: route the
 * edge as a bracket around the side of the column instead of through the cards.
 */
function columnLoop(source: InternalNode, target: InternalNode): [string, number, number] | null {
  const s = box(source);
  const t = box(target);
  const gap = Math.abs(t.cy - s.cy) - (s.h + t.h) / 2;
  if (Math.abs(t.cx - s.cx) > 40 || gap < 80) return null;
  // The question/insight column fans out to the right, so loop on its left; otherwise loop right.
  const side = source.type === "question" || source.type === "insight" ? -1 : 1;
  const sx = side < 0 ? s.x : s.x + s.w;
  const tx = side < 0 ? t.x : t.x + t.w;
  const k = side * (48 + Math.abs(t.cy - s.cy) * 0.03);
  const path = `M ${sx} ${s.cy} C ${sx + k} ${s.cy}, ${tx + k} ${t.cy}, ${tx} ${t.cy}`;
  const edgeX = side < 0 ? Math.min(sx, tx) : Math.max(sx, tx);
  return [path, edgeX + k * 0.75, (s.cy + t.cy) / 2];
}

/** Attach the edge to whichever sides of the two nodes face each other. */
function floatingParams(source: InternalNode, target: InternalNode) {
  const s = box(source);
  const t = box(target);
  const dx = t.cx - s.cx;
  const dy = t.cy - s.cy;
  const horizontal = Math.abs(dx) * 0.6 >= Math.abs(dy) || Math.abs(dx) > (s.w + t.w) / 2;

  if (horizontal) {
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
  if (!sourceNode || !targetNode || !data) return null;

  const style = RELATION_STYLES[data.relation];
  const [path, labelX, labelY] =
    columnLoop(sourceNode, targetNode) ??
    getBezierPath({ ...floatingParams(sourceNode, targetNode), curvature: 0.3 });
  const focus = selected || data.emphasis === "focus";
  const dim = data.emphasis === "dim";

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
          opacity: dim ? 0.15 : focus ? 1 : 0.7,
          transition: "opacity 200ms, stroke-width 200ms",
        }}
      />
      {style.flow && !dim && (
        <path d={path} className="rh-edge-flow" stroke={style.color} fill="none" />
      )}
      <EdgeLabelRenderer>
        <div
          className={cn(
            "nodrag nopan pointer-events-auto absolute rounded-full border bg-background/90 px-1.5 py-px text-[10px] leading-4 font-medium backdrop-blur transition-opacity duration-200",
            dim ? "opacity-0" : focus ? "opacity-100" : "opacity-75",
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
