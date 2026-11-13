"use client";

import { useMemo, type Dispatch } from "react";
import {
  Background,
  BackgroundVariant,
  Panel,
  type EdgeChange,
  ReactFlow,
  useReactFlow,
  useStore,
} from "@xyflow/react";
import { Maximize, Minus, Plus } from "lucide-react";

import type { BoardAction } from "@/graph/board-state";
import type { ResearchEdge, ResearchNode } from "@/graph/types";
import { Button } from "@/components/ui/button";
import { nodeTypes } from "./nodes";
import { edgeTypes, RelationMarkers, type DisplayEdge } from "./relation-edge";

export const FIT_VIEW_OPTIONS = { padding: 0.15, duration: 500 };

function ZoomControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  return (
    <Panel position="bottom-right">
      <div className="flex items-center gap-0.5 rounded-xl border border-white/10 bg-card/90 p-1 shadow-lg backdrop-blur">
        <Button variant="ghost" size="icon-sm" aria-label="Zoom out" onClick={() => zoomOut({ duration: 200 })}>
          <Minus />
        </Button>
        <span className="w-11 text-center text-xs text-muted-foreground tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        <Button variant="ghost" size="icon-sm" aria-label="Zoom in" onClick={() => zoomIn({ duration: 200 })}>
          <Plus />
        </Button>
        <div className="mx-0.5 h-4 w-px bg-white/10" />
        <Button variant="ghost" size="icon-sm" aria-label="Fit to view" onClick={() => fitView(FIT_VIEW_OPTIONS)}>
          <Maximize />
        </Button>
      </div>
    </Panel>
  );
}

export function BoardCanvas({
  nodes,
  edges,
  isDemo,
  dispatch,
}: {
  nodes: ResearchNode[];
  edges: ResearchEdge[];
  isDemo: boolean;
  dispatch: Dispatch<BoardAction>;
}) {
  const selectedId = nodes.find((n) => n.selected)?.id ?? null;

  // Focus mode: when a node is selected, dim everything not directly connected.
  const { displayNodes, displayEdges } = useMemo(() => {
    if (!selectedId) return { displayNodes: nodes, displayEdges: edges as DisplayEdge[] };
    const neighbours = new Set([selectedId]);
    for (const e of edges) {
      if (e.source === selectedId) neighbours.add(e.target);
      if (e.target === selectedId) neighbours.add(e.source);
    }
    return {
      displayNodes: nodes.map((n) => (neighbours.has(n.id) ? n : { ...n, className: "rh-dim" })),
      displayEdges: edges.map(
        (e): DisplayEdge => ({
          ...e,
          data: {
            ...e.data!,
            emphasis: e.source === selectedId || e.target === selectedId ? "focus" : "dim",
          },
        }),
      ),
    };
  }, [nodes, edges, selectedId]);

  return (
    <ReactFlow<ResearchNode, DisplayEdge>
      nodes={displayNodes}
      edges={displayEdges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={(changes) => dispatch({ type: "nodesChange", changes })}
      // Only select/remove changes are emitted here; they carry ids, not edge objects.
      onEdgesChange={(changes) =>
        dispatch({ type: "edgesChange", changes: changes as EdgeChange<ResearchEdge>[] })
      }
      onPaneClick={() => dispatch({ type: "select", nodeId: null })}
      nodesConnectable={false}
      deleteKeyCode={null}
      colorMode="dark"
      fitView
      fitViewOptions={{ padding: 0.15 }}
      minZoom={0.2}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      className="rh-board"
    >
      <RelationMarkers />
      <Background
        variant={BackgroundVariant.Dots}
        gap={22}
        size={1.2}
        color="rgb(255 255 255 / 0.09)"
        bgColor="transparent"
      />
      <ZoomControls />
      {isDemo && (
        <Panel position="top-left">
          <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 px-2.5 py-1.5 text-[11px] text-amber-200/80 backdrop-blur">
            Demo data · illustrative content, not live research
          </div>
        </Panel>
      )}
      {nodes.length === 0 && (
        <Panel position="top-center" className="mt-32 text-sm text-muted-foreground">
          Add a research question to start your board.
        </Panel>
      )}
    </ReactFlow>
  );
}
