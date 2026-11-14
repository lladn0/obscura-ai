"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import { Menu } from "@base-ui/react/menu";
import {
  FoldVertical,
  UnfoldVertical,
  Ellipsis,
  LayoutDashboard,
  Maximize,
  Maximize2,
  Minimize2,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightOpen,
  Rabbit,
  RotateCcw,
  Sun,
} from "lucide-react";

import type { ActionRequest, NodeAction } from "@/agents/research/protocol";
import { useResearchAgent } from "@/agents/research/use-research-agent";
import { ancestors, descendants } from "@/graph/hierarchy";
import { LAYOUT_MODES, type LayoutMode } from "@/graph/layout";
import { useBoard } from "@/graph/use-board";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BoardCanvas } from "./board-canvas";
import { AgentStatus, CostIndicator } from "./agent-status";
import { NodeDetails } from "./node-details";
import { ResearchSidebar } from "./research-sidebar";
import { usePersistentState } from "./use-persistent-state";

const MODE_META: Record<LayoutMode, { label: string; icon: typeof Sun; hint: string }> = {
  sun: { label: "Sun", icon: Sun, hint: "Radial: the question at the centre, branches radiating out" },
  tree: { label: "Tree", icon: Network, hint: "Hierarchy: the question on top, topics branching down" },
};

function LayoutSwitch({ mode, onChange }: { mode: LayoutMode; onChange: (m: LayoutMode) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label="Board layout"
      className="flex items-center rounded-lg border border-white/10 bg-white/[0.03] p-0.5"
    >
      {LAYOUT_MODES.map((m) => {
        const { label, icon: Icon, hint } = MODE_META[m];
        const active = m === mode;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={active}
            title={hint}
            onClick={() => onChange(m)}
            className={cn(
              "flex h-6 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-semibold tracking-[0.12em] uppercase transition-colors",
              active ? "bg-white/10 text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        );
      })}
    </div>
  );
}

function MenuItem({ icon: Icon, children, onClick }: { icon: typeof Sun; children: React.ReactNode; onClick: () => void }) {
  return (
    <Menu.Item
      onClick={onClick}
      className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground/90 outline-none select-none data-highlighted:bg-white/[0.07] data-highlighted:text-foreground [&_svg]:size-3.5 [&_svg]:text-muted-foreground"
    >
      <Icon />
      {children}
    </Menu.Item>
  );
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

function WorkspaceInner() {
  const board = useBoard();
  const { state, dispatch, mode, setMode, hierarchy, visible, collapsed } = board;
  const { setCenter, getNode, getZoom } = useReactFlow();
  const agent = useResearchAgent(dispatch);
  const busy = useMemo(() => new Set(agent.active.keys()), [agent.active]);

  /**
   * Run a user action on a node. The server keeps no board state, so the
   * request carries just enough context: the node, its path to the root, its
   * existing children, the branch (for gaps) and already-known source URLs.
   */
  const runNodeAction = (nodeId: string, kind: NodeAction) => {
    const node = state.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const byId = new Map(state.nodes.map((n) => [n.id, n]));
    const label = (id: string) => byId.get(id)?.data.label ?? "";
    const verificationOf = (id: string) => {
      const n = byId.get(id);
      return n?.type === "claim" ? n.data.verification : undefined;
    };
    const knownSources: Record<string, string> = {};
    for (const n of state.nodes) if (n.type === "source" && n.data.url) knownSources[n.data.url] = n.id;

    const request: ActionRequest = {
      kind,
      actionId: `${kind}-${crypto.randomUUID().slice(0, 8)}`,
      target: {
        id: node.id,
        kind: node.type,
        label: node.data.label,
        description: node.data.description,
        verification: verificationOf(node.id),
        path: ancestors(hierarchy, node.id).reverse().map(label),
        children: (hierarchy.children.get(node.id) ?? []).map(label).filter(Boolean),
        branch:
          kind === "gaps"
            ? descendants(hierarchy, node.id)
                .map((id) => byId.get(id)!)
                .filter((n) => n.type !== "source")
                .map((n) => ({ label: n.data.label, kind: n.type, verification: verificationOf(n.id) }))
            : undefined,
      },
      knownSources,
    };
    // Expand the node so the new results are visible as they stream in.
    if (collapsed.has(node.id)) dispatch({ type: "toggleCollapse", nodeId: node.id });
    void agent.runAction(node.data.researchId ?? "board", request);
  };
  const selected = state.nodes.find((n) => n.selected) ?? null;

  const [sidebarOpen, setSidebarOpen] = usePersistentState("rabbithole:sidebar-open", true);
  const [detailsOpen, setDetailsOpen] = usePersistentState("rabbithole:details-open", true);
  const [focusMode, setFocusMode] = usePersistentState("rabbithole:focus-mode", false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const showSidebar = sidebarOpen && !focusMode;
  const detailsWidth = !selected || focusMode ? 0 : detailsOpen ? 320 : 44;

  const centerOn = useCallback(
    (id: string) => {
      const node = getNode(id);
      if (!node) return;
      const w = node.measured?.width ?? 0;
      const h = node.measured?.height ?? 0;
      setCenter(node.position.x + w / 2, node.position.y + h / 2, { duration: 500, zoom: Math.max(getZoom(), 0.7) });
    },
    [getNode, getZoom, setCenter],
  );

  /** Select a node, unfolding its branch if needed, and bring it into view. */
  const focusNode = useCallback(
    (id: string) => {
      dispatch({ type: "select", nodeId: id });
      if (visible.has(id)) return centerOn(id);
      const unfold = new Set(ancestors(hierarchy, id));
      dispatch({ type: "setCollapsed", nodeIds: state.collapsed.filter((c) => !unfold.has(c)) });
      setTimeout(() => centerOn(id), 650);
    },
    [dispatch, visible, hierarchy, state.collapsed, centerOn],
  );

  /**
   * Research a question through the agent. From the demo board it starts a
   * fresh board; on a real board the new question joins as another branch.
   */
  const startResearch = (question: string) => {
    if (agent.running) return;
    const fresh = state.isDemo || state.nodes.length === 0;
    if (fresh) board.newBoard(question);
    const researchId = `r-${crypto.randomUUID().slice(0, 8)}`;
    void agent.startResearch({ question, researchId }).then(() => {
      if (fresh) board.fit();
    });
  };

  const openResearchInput = useCallback(() => {
    setFocusMode(false);
    setSidebarOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [setFocusMode, setSidebarOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (e.key === "/") {
        e.preventDefault();
        openResearchInput();
      } else if (e.key === "f") {
        setFocusMode((f) => !f);
      } else if (e.key === "[") {
        setSidebarOpen((o) => !o);
      } else if (e.key === "Escape") {
        if (selected) dispatch({ type: "select", nodeId: null });
        else setFocusMode(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, dispatch, openResearchInput, setFocusMode, setSidebarOpen]);

  const toggleBranch = (id: string) => dispatch({ type: "toggleCollapse", nodeId: id });
  const folded = state.collapsed.length > 0;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <header className="grid h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-white/[0.06] px-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={showSidebar ? "Hide sidebar" : "Show sidebar"}
            title={showSidebar ? "Hide sidebar ([)" : "Show sidebar ([)"}
            onClick={() => (focusMode ? openResearchInput() : setSidebarOpen(!sidebarOpen))}
          >
            {showSidebar ? <PanelLeftClose /> : <PanelLeftOpen />}
          </Button>
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-violet-500 to-fuchsia-500">
            <Rabbit className="size-3.5 text-white" />
          </span>
          <span className="truncate text-sm font-medium" title={state.title}>
            {state.title}
          </span>
          {state.isDemo && (
            <Badge
              variant="outline"
              className="shrink-0 border-amber-400/30 text-amber-200/80"
              title="Illustrative content, not live research"
            >
              Demo
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          <LayoutSwitch mode={mode} onChange={setMode} />
          <AgentStatus research={agent.research} running={agent.running} error={agent.error} />
          <CostIndicator usage={agent.usage} />
        </div>

        <div className="flex items-center justify-end gap-1">
          <Button
            variant={focusMode ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={focusMode}
            title="Full canvas: hide side panels (F)"
            onClick={() => setFocusMode(!focusMode)}
          >
            {focusMode ? <Minimize2 /> : <Maximize2 />}
            <span className="hidden sm:inline">Full canvas</span>
          </Button>
          <Menu.Root>
            <Menu.Trigger
              render={<Button variant="ghost" size="icon-sm" aria-label="More board actions" />}
            >
              <Ellipsis />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner align="end" sideOffset={6} className="z-50">
                <Menu.Popup className="min-w-52 rounded-xl border border-white/10 bg-popover/95 p-1 shadow-xl backdrop-blur outline-none">
                  <MenuItem icon={Maximize} onClick={board.fit}>Fit to view</MenuItem>
                  <MenuItem icon={LayoutDashboard} onClick={() => board.unpin("all")}>
                    Tidy layout
                  </MenuItem>
                  <MenuItem icon={folded ? UnfoldVertical : FoldVertical} onClick={folded ? board.expandAll : board.collapseToBranches}>
                    {folded ? "Expand all branches" : "Collapse to main branches"}
                  </MenuItem>
                  <Menu.Separator className="my-1 h-px bg-white/[0.08]" />
                  <MenuItem icon={RotateCcw} onClick={board.resetDemo}>Reset demo board</MenuItem>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside
          aria-label="Research"
          aria-hidden={!showSidebar}
          inert={!showSidebar}
          className={cn(
            "shrink-0 overflow-hidden bg-sidebar/60 transition-[width] duration-300 ease-out",
            showSidebar && "border-r border-white/[0.06]",
          )}
          style={{ width: showSidebar ? 288 : 0 }}
        >
          <ResearchSidebar
            nodes={state.nodes}
            activity={state.activity}
            selectedId={selected?.id ?? null}
            inputRef={inputRef}
            onAddQuestion={startResearch}
            busy={agent.running}
            onSelect={focusNode}
          />
        </aside>

        <main className="relative min-w-0 flex-1">
          <BoardCanvas board={board} busy={busy} />
        </main>

        <aside
          aria-label="Node details"
          className={cn(
            "shrink-0 overflow-hidden bg-sidebar/60 transition-[width] duration-300 ease-out",
            detailsWidth > 0 && "border-l border-white/[0.06]",
          )}
          style={{ width: detailsWidth }}
        >
          {selected && !detailsOpen && (
            <div className="flex justify-center pt-2">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Show details"
                title="Show details"
                onClick={() => setDetailsOpen(true)}
              >
                <PanelRightOpen />
              </Button>
            </div>
          )}
          {selected && detailsOpen && (
            <NodeDetails
              key={selected.id}
              node={selected}
              nodes={state.nodes}
              edges={state.edges}
              branch={{
                children: hierarchy.children.get(selected.id)?.length ?? 0,
                collapsed: collapsed.has(selected.id),
                hidden: collapsed.has(selected.id) ? descendants(hierarchy, selected.id).length : 0,
              }}
              researchDepth={hierarchy.researchDepth.get(selected.id) ?? 0}
              pinned={!!state.pinned[mode][selected.id]}
              onSelect={focusNode}
              onCenter={() => centerOn(selected.id)}
              onToggleBranch={() => toggleBranch(selected.id)}
              onUnpin={() => board.unpin([selected.id])}
              investigate={{
                active: agent.active.get(selected.id),
                note: agent.notes[selected.id],
                onRun: (kind) => runNodeAction(selected.id, kind),
              }}
              onCollapsePanel={() => setDetailsOpen(false)}
              onClose={() => dispatch({ type: "select", nodeId: null })}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

export default function Workspace() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit">
      <ReactFlowProvider>
        <WorkspaceInner />
      </ReactFlowProvider>
    </CopilotKitProvider>
  );
}
