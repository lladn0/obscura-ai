"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Panel,
  type EdgeChange,
  ReactFlow,
  useReactFlow,
  useStore,
  type XYPosition,
} from "@xyflow/react";
import {
  FoldVertical,
  Maximize,
  Minus,
  PenLine,
  Plus,
  ScanSearch,
  Spline,
  StickyNote,
  Trash2,
  UnfoldVertical,
  X,
} from "lucide-react";

import { ancestors, descendants } from "@/graph/hierarchy";
import type { Board } from "@/graph/use-board";
import type { EdgeRelation, ResearchEdge, ResearchNode } from "@/graph/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BoardViewContext, type BoardView } from "./board-context";
import { nodeTypes } from "./nodes";
import { edgeTypes, RelationMarkers, type DisplayEdge } from "./relation-edge";
import { MANUAL_RELATIONS, RELATION_STYLES } from "./styles";

function CanvasControls({
  board,
  connectMode,
  onToggleConnect,
  onAddNote,
}: {
  board: Board;
  connectMode: boolean;
  onToggleConnect: () => void;
  onAddNote: () => void;
}) {
  const { zoomIn, zoomOut } = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  return (
    <Panel position="bottom-right">
      <div className="flex items-center gap-0.5 rounded-xl border border-white/10 bg-card/90 p-1 shadow-lg backdrop-blur">
        <Button variant="ghost" size="icon-sm" aria-label="Add note" title="Add note (N)" onClick={onAddNote}>
          <StickyNote />
        </Button>
        <Button
          variant={connectMode ? "secondary" : "ghost"}
          size="icon-sm"
          aria-pressed={connectMode}
          aria-label="Connect nodes"
          title={connectMode ? "Connect mode: drag from one card onto another (C to exit)" : "Connect nodes (C)"}
          onClick={onToggleConnect}
          className={cn(connectMode && "text-sky-300")}
        >
          <Spline />
        </Button>
        <div className="mx-0.5 h-4 w-px bg-white/10" />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Collapse all"
          title="Collapse all: keep the question and main topics"
          onClick={board.collapseToBranches}
        >
          <FoldVertical />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Expand all"
          title="Expand all branches"
          onClick={board.expandAll}
        >
          <UnfoldVertical />
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

/** Relationship type, custom label and delete for the selected connection. */
function EdgeEditor({ edge, board }: { edge: ResearchEdge; board: Board }) {
  const data = edge.data!;
  const [custom, setCustom] = useState(!!data.label);
  const [label, setLabel] = useState(data.label ?? "");
  const set = (relation: EdgeRelation, text?: string) =>
    board.commit({ type: "editEdge", edgeId: edge.id, relation, label: text, width: data.width });
  const options: EdgeRelation[] = [...MANUAL_RELATIONS];
  if (!options.includes(data.relation)) options.push(data.relation);
  return (
    <Panel position="top-center" className="max-w-[min(640px,calc(100%-2rem))]">
      <div
        className="rh-fade-in flex flex-wrap items-center gap-1 rounded-2xl border border-white/10 bg-card/90 p-1 text-xs shadow-lg backdrop-blur"
        onKeyDown={(e) => e.stopPropagation()}
      >
        {options.map((r) => {
          const active = !custom && data.relation === r;
          return (
            <button
              key={r}
              type="button"
              onClick={() => {
                setCustom(false);
                set(r);
              }}
              className={cn(
                "rounded-full border px-2 py-0.5 transition-colors",
                active ? "bg-white/10" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
              style={active ? { color: RELATION_STYLES[r].color, borderColor: `${RELATION_STYLES[r].color}60` } : undefined}
            >
              {RELATION_STYLES[r].label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setCustom(true)}
          className={cn(
            "rounded-full border px-2 py-0.5",
            custom ? "border-white/20 bg-white/10 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          custom
        </button>
        {custom && (
          <input
            autoFocus
            value={label}
            placeholder="Relationship…"
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => set(data.relation, label.trim())}
            onKeyDown={(e) => e.key === "Enter" && set(data.relation, label.trim())}
            className="h-6 w-36 rounded-md border border-white/15 bg-background/60 px-1.5 text-xs outline-none focus:border-white/30"
          />
        )}
        {data.manual && (
          <>
            <div className="mx-0.5 h-4 w-px bg-white/10" />
            {EDGE_WIDTHS.map(({ label: name, width }) => (
              <button
                key={name}
                type="button"
                title={`${name} line`}
                aria-label={`${name} line`}
                onClick={() => board.commit({ type: "editEdge", edgeId: edge.id, relation: data.relation, label: data.label, width })}
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-md hover:bg-white/10",
                  (data.width ?? 2.2) === width && "bg-white/10",
                )}
              >
                <span className="w-3.5 rounded-full bg-foreground/70" style={{ height: width }} />
              </button>
            ))}
          </>
        )}
        <div className="mx-0.5 h-4 w-px bg-white/10" />
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Delete connection"
          title="Delete connection (Del)"
          onClick={() => board.commit({ type: "deleteEdges", edgeIds: [edge.id] })}
          className="text-rose-300 hover:text-rose-200"
        >
          <Trash2 />
        </Button>
      </div>
    </Panel>
  );
}

const EDGE_WIDTHS = [
  { label: "Thin", width: 1.5 },
  { label: "Normal", width: 2.2 },
  { label: "Thick", width: 3.5 },
];

type MenuState = { x: number; y: number; flow: XYPosition; nodeId?: string };

/** Right-click menu: add a note on the pane, edit/delete on a node. */
function ContextMenu({ menu, board, onClose }: { menu: MenuState; board: Board; onClose: () => void }) {
  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  const descendantsCount = menu.nodeId ? descendants(board.hierarchy, menu.nodeId).length : 0;
  const item = (label: string, Icon: typeof X, run: () => void, danger = false) => (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => {
        run();
        onClose();
      }}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-white/[0.07]",
        danger ? "text-rose-300" : "text-foreground/90",
      )}
    >
      <Icon className="size-3.5 opacity-70" />
      {label}
    </button>
  );
  return (
    <div
      className="rh-fade-in absolute z-50 min-w-48 rounded-xl border border-white/10 bg-popover/95 p-1 shadow-xl backdrop-blur"
      style={{ left: menu.x, top: menu.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.nodeId ? (
        <>
          {item("Edit", PenLine, () => {
            board.dispatch({ type: "select", nodeId: menu.nodeId! });
            board.setEditing(menu.nodeId!);
          })}
          {item("Delete", Trash2, () => board.deleteNode(menu.nodeId!), true)}
          {descendantsCount > 0 &&
            item(`Delete with branch (${descendantsCount + 1})`, Trash2, () => board.deleteNode(menu.nodeId!, true), true)}
        </>
      ) : (
        item("Add note here", StickyNote, () => {
          const id = board.addNote(menu.flow);
          board.setEditing(id);
        })
      )}
    </div>
  );
}

/** Shown while a branch is focused: names it and offers an obvious way out. */
function BranchFocusBar({
  label,
  size,
  onFit,
  onExit,
}: {
  label: string;
  size: number;
  onFit: () => void;
  onExit: () => void;
}) {
  return (
    <Panel position="top-center" className="max-w-[min(560px,calc(100%-2rem))]">
      <div className="rh-fade-in flex min-w-0 items-center gap-1 rounded-full border border-white/10 bg-card/90 py-1 pr-1 pl-3 text-xs shadow-lg backdrop-blur">
        <span className="shrink-0 text-muted-foreground">Branch focus</span>
        <span className="min-w-0 truncate font-medium text-foreground" title={label}>
          {label}
        </span>
        <span className="shrink-0 text-muted-foreground tabular-nums">· {size} nodes</span>
        <Button variant="ghost" size="xs" className="ml-1 rounded-full" onClick={onFit} title="Fit the branch in view">
          <ScanSearch /> Fit branch
        </Button>
        <Button variant="secondary" size="xs" className="rounded-full" onClick={onExit} title="Exit branch focus (Esc)">
          <X /> Exit
          <kbd className="ml-0.5 rounded border border-white/15 px-1 font-sans text-[10px] text-muted-foreground">Esc</kbd>
        </Button>
      </div>
    </Panel>
  );
}

export function BoardCanvas({
  board,
  busy,
  connectMode,
  onToggleConnect,
  onUserSelect,
}: {
  /** Deliberate node selection by the user (for engagement statistics). */
  onUserSelect?: (nodeId: string) => void;
  board: Board;
  busy: ReadonlySet<string>;
  connectMode: boolean;
  onToggleConnect: () => void;
}) {
  const { state, dispatch, hierarchy, visible, collapsed, mode } = board;
  const { fitView, screenToFlowPosition } = useReactFlow();
  const { nodes, edges } = state;
  const selectedNode = nodes.find((n) => n.selected) ?? null;
  const selectedId = selectedNode?.id ?? null;
  const selectedEdge = selectedNode ? null : (edges.find((e) => e.selected) ?? null);
  const wrapper = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  const openMenu = (e: MouseEvent | React.MouseEvent, nodeId?: string) => {
    e.preventDefault();
    const rect = wrapper.current!.getBoundingClientRect();
    setMenu({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      flow: screenToFlowPosition({ x: e.clientX, y: e.clientY }),
      nodeId,
    });
  };

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

  /**
   * Notes linked (by manual arrows) to research nodes fold with those branches:
   * visible while at least one linked node is visible and unfolded. Standalone
   * notes are never hidden.
   */
  const hiddenNotes = useMemo(() => {
    const kinds = new Map(nodes.map((n) => [n.id, n.type]));
    const links = new Map<string, string[]>();
    for (const e of edges) {
      if (!e.data?.manual) continue;
      for (const [a, b] of [[e.source, e.target], [e.target, e.source]])
        if (kinds.get(a) === "note" && kinds.get(b) !== "note" && kinds.has(b))
          links.set(a, [...(links.get(a) ?? []), b]);
    }
    const hidden = new Set<string>();
    for (const [note, attached] of links)
      if (!attached.some((id) => visible.has(id) && !collapsed.has(id))) hidden.add(note);
    return hidden;
  }, [nodes, edges, visible, collapsed]);

  const displayNodes = useMemo(
    () =>
      nodes.map((n): ResearchNode => {
        const hidden = n.type === "note" ? hiddenNotes.has(n.id) : !visible.has(n.id);
        const dim = !!branch && !branch.has(n.id);
        return hidden || dim || n.hidden ? { ...n, hidden, className: dim ? "rh-dim" : undefined } : n;
      }),
    [nodes, visible, branch, hiddenNotes],
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
      busy,
      editingId: board.editingId,
      setEditing: board.setEditing,
      saveEdit: (id, edit) => board.commit({ type: "editNode", nodeId: id, edit }),
      minimizeNote: (id, minimized) => dispatch({ type: "minimizeNotes", nodeIds: [id], minimized }),
    }),
    [mode, hierarchy, collapsed, dispatch, busy, board.editingId, board.setEditing, board.commit],
  );

  return (
    <BoardViewContext.Provider value={view}>
      <div ref={wrapper} className="relative size-full">
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
        onNodeDoubleClick={(_, node) => board.setEditing(node.id)}
        onNodeClick={(_, node) => onUserSelect?.(node.id)}
        onPaneContextMenu={(e) => openMenu(e)}
        onNodeContextMenu={(e, node) => openMenu(e, node.id)}
        // Manual links are visual only: never research, never hierarchy.
        onConnect={(c) =>
          board.commit({ type: "connect", edgeId: `manual-${crypto.randomUUID().slice(0, 8)}`, source: c.source, target: c.target })
        }
        nodesConnectable={connectMode}
        nodesDraggable={!connectMode}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={40}
        zoomOnDoubleClick={false}
        deleteKeyCode={null}
        colorMode="dark"
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.15}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        className={cn("rh-board", connectMode && "rh-connecting")}
      >
        <RelationMarkers />
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1.2}
          color="rgb(255 255 255 / 0.07)"
          bgColor="transparent"
        />
        <CanvasControls
          board={board}
          connectMode={connectMode}
          onToggleConnect={onToggleConnect}
          onAddNote={board.addNoteAtCenter}
        />
        {selectedEdge && <EdgeEditor key={selectedEdge.id} edge={selectedEdge} board={board} />}
        {connectMode && !selectedEdge && (
          <Panel position="top-center">
            <div className="rh-fade-in rounded-full border border-sky-400/30 bg-card/90 px-3 py-1 text-xs text-sky-200 shadow-lg backdrop-blur">
              Drag from one card onto another to connect them · Esc to finish
            </div>
          </Panel>
        )}
        {branch && selectedId && selectedNode?.type !== "note" && !connectMode && (
          <BranchFocusBar
            label={nodes.find((n) => n.id === selectedId)?.data.label ?? ""}
            size={[...branch].filter((id) => visible.has(id)).length}
            onFit={() =>
              fitView({
                nodes: [...branch].filter((id) => visible.has(id)).map((id) => ({ id })),
                padding: 0.25,
                duration: 500,
                maxZoom: 1.2,
              })
            }
            onExit={() => dispatch({ type: "select", nodeId: null })}
          />
        )}
        {nodes.length === 0 && (
          <Panel position="top-center" className="mt-32 text-sm text-muted-foreground">
            Ask a research question to start your board.
          </Panel>
        )}
      </ReactFlow>
      {menu && <ContextMenu menu={menu} board={board} onClose={() => setMenu(null)} />}
      </div>
    </BoardViewContext.Provider>
  );
}
