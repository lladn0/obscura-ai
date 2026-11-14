"use client";

import { useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  Panel,
  type EdgeChange,
  ReactFlow,
  useReactFlow,
  useStore,
} from "@xyflow/react";
import { FoldVertical, UnfoldVertical, Maximize, Minus, Plus } from "lucide-react";

import { ancestors, descendants } from "@/graph/hierarchy";
import type { Board } from "@/graph/use-board";
import type { ResearchEdge, ResearchNode } from "@/graph/types";
import { Button } from "@/components/ui/button";
import { BoardViewContext, type BoardView } from "./board-context";
import { nodeTypes } from "./nodes";
import { edgeTypes, RelationMarkers, type DisplayEdge } from "./relation-edge";

function CanvasControls({ board }: { board: Board }) {
  const { zoomIn, zoomOut } = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  const folded = board.state.collapsed.length > 0;
  return (
    <Panel position="bottom-right">
      <div className="flex items-center gap-0.5 rounded-xl border border-white/10 bg-card/90 p-1 shadow-lg backdrop-blur">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={folded ? "Expand all branches" : "Collapse to main branches"}
          title={folded ? "Expand all branches" : "Collapse to main branches"}
          onClick={folded ? board.expandAll : board.collapseToBranches}
        >
          {folded ? <UnfoldVertical /> : <FoldVertical />}
        </Button>
        <div className="mx-0.5 h-4 w-px bg-white/10" />
        <Button variant="ghost" size="icon-sm" aria-label="Zoom out" onClick={() => zoomOut({ duration: 200 })}>
          <Minus />
        </Button>
        <span className="w-10 text-center text-xs text-muted-foreground tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        <Button variant="ghost" size="icon-sm" aria-label="Zoom in" onClick={() => zoomIn({ duration: 200 })}>
          <Plus />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Fit to view" title="Fit to view" onClick={board.fit}>
          <Maximize />
        </Button>
      </div>
    </Panel>
  );
}

export function BoardCanvas({ board }: { board: Board }) {
  const { state, dispatch, hierarchy, visible, collapsed, mode } = board;
  const { nodes, edges } = state;
  const selectedId = nodes.find((n) => n.selected)?.id ?? null;

  // The selected node's branch: its path to the root, everything below it, and direct links.
  const branch = useMemo(() => {
    if (!selectedId) return null;
    const ids = new Set([selectedId, ...ancestors(hierarchy, selectedId), ...descendants(hierarchy, selectedId)]);
    for (const e of edges) {
      if (e.source === selectedId) ids.add(e.target);
      if (e.target === selectedId) ids.add(e.source);
    }
    return ids;
  }, [selectedId, hierarchy, edges]);

  const displayNodes = useMemo(
    () =>
      nodes.map((n): ResearchNode => {
        const hidden = !visible.has(n.id);
        const dim = !!branch && !branch.has(n.id);
        return hidden || dim || n.hidden ? { ...n, hidden, className: dim ? "rh-dim" : undefined } : n;
      }),
    [nodes, visible, branch],
  );

  const displayEdges = useMemo(
    () =>
      edges.map((e): DisplayEdge => {
        if (!branch) return e as DisplayEdge;
        const touches = e.source === selectedId || e.target === selectedId;
        const inBranch = branch.has(e.source) && branch.has(e.target);
        const isTreeEdge =
          hierarchy.parent.get(e.target) === e.source || hierarchy.parent.get(e.source) === e.target;
        return {
          ...e,
          data: { ...e.data!, emphasis: touches || (inBranch && isTreeEdge) ? "focus" : "dim" },
        };
      }),
    [edges, branch, selectedId, hierarchy],
  );

  const view = useMemo<BoardView>(
    () => ({
      mode,
      hierarchy,
      collapsed,
      toggleCollapse: (id) => dispatch({ type: "toggleCollapse", nodeId: id }),
    }),
    [mode, hierarchy, collapsed, dispatch],
  );

  return (
    <BoardViewContext.Provider value={view}>
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
        onNodeDragStart={board.stopAnimation}
        onNodeDragStop={(_, __, dragged) => board.pinDragged(dragged.map((n) => n.id))}
        onPaneClick={() => dispatch({ type: "select", nodeId: null })}
        nodesConnectable={false}
        deleteKeyCode={null}
        colorMode="dark"
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.15}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        className="rh-board"
      >
        <RelationMarkers />
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1.2}
          color="rgb(255 255 255 / 0.07)"
          bgColor="transparent"
        />
        <CanvasControls board={board} />
        {nodes.length === 0 && (
          <Panel position="top-center" className="mt-32 text-sm text-muted-foreground">
            Ask a research question to start your board.
          </Panel>
        )}
      </ReactFlow>
    </BoardViewContext.Provider>
  );
}
