"use client";

import { useCallback } from "react";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import { LayoutDashboard, Maximize, Rabbit, RotateCcw } from "lucide-react";

import { useBoard } from "@/graph/use-board";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BoardCanvas, FIT_VIEW_OPTIONS } from "./board-canvas";
import { NodeDetails } from "./node-details";
import { ResearchSidebar } from "./research-sidebar";

function WorkspaceInner() {
  const { state, dispatch, relayout, resetDemo } = useBoard();
  const { fitView, setCenter, getNode, getZoom } = useReactFlow();
  const selected = state.nodes.find((n) => n.selected) ?? null;

  const fit = useCallback(() => fitView(FIT_VIEW_OPTIONS), [fitView]);

  const focusNode = useCallback(
    (id: string) => {
      dispatch({ type: "select", nodeId: id });
      const node = getNode(id);
      if (node) {
        const w = node.measured?.width ?? 0;
        const h = node.measured?.height ?? 0;
        setCenter(node.position.x + w / 2, node.position.y + h / 2, { duration: 500, zoom: getZoom() });
      }
    },
    [dispatch, getNode, getZoom, setCenter],
  );

  const addQuestion = (label: string) => {
    const id = `q-${crypto.randomUUID().slice(0, 8)}`;
    dispatch({
      type: "merge",
      patch: {
        nodes: [{ id, type: "question", data: { label, status: "open" } }],
        activity: `Added question: “${label}”`,
      },
    });
    requestAnimationFrame(() => focusNode(id));
  };

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-white/[0.06] px-4">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-[0_0_20px_-4px_rgb(168_85_247/0.7)]">
            <Rabbit className="size-4 text-white" />
          </span>
          <span className="text-sm font-semibold tracking-tight">RabbitHole AI</span>
        </div>
        <span className="text-white/15">/</span>
        <span className="truncate text-sm text-muted-foreground">{state.title}</span>
        {state.isDemo && (
          <Badge variant="outline" className="border-amber-400/30 text-amber-200/80">
            Demo data
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => relayout(fit)}>
            <LayoutDashboard /> Auto-layout
          </Button>
          <Button variant="ghost" size="sm" onClick={fit}>
            <Maximize /> Fit view
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              resetDemo();
              requestAnimationFrame(() => fit());
            }}
          >
            <RotateCcw /> Reset demo
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <ResearchSidebar nodes={state.nodes} activity={state.activity} onAddQuestion={addQuestion} />
        <main className="relative min-w-0 flex-1">
          <BoardCanvas nodes={state.nodes} edges={state.edges} isDemo={state.isDemo} dispatch={dispatch} />
        </main>
        <NodeDetails node={selected} nodes={state.nodes} edges={state.edges} onSelect={focusNode} />
      </div>
    </div>
  );
}

export default function Workspace() {
  return (
    <ReactFlowProvider>
      <WorkspaceInner />
    </ReactFlowProvider>
  );
}
