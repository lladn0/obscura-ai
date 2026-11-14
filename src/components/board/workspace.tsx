"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import Link from "next/link";
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
  ArrowLeft,
  CircleCheck,
  MessageSquarePlus,
  RotateCcw,
  Square,
  Sun,
} from "lucide-react";

import type { ActionRequest, NodeAction } from "@/agents/research/protocol";
import { useResearchAgent } from "@/agents/research/use-research-agent";
import { ancestors, descendants } from "@/graph/hierarchy";
import { LAYOUT_MODES, type LayoutMode } from "@/graph/layout";
import { useBoard } from "@/graph/use-board";
import { findImage } from "@/integrations/wikimedia";
import { boardClosed, boardOpened, completeSession, lastSession, nodeSelected, viewNode } from "@/analytics/engagement";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BoardCanvas } from "./board-canvas";
import { AgentStatus, CostIndicator } from "./agent-status";
import { NodeDetails } from "./node-details";
import { BottomSheet } from "./bottom-sheet";
import { useIsMobile } from "@/lib/use-media";
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

/** Boards whose ?q= research was already started (guards React's double effects). */
const autoStarted = new Set<string>();

const formatDuration = (ms: number) => {
  const m = Math.round(ms / 60000);
  return m < 1 ? "<1 min" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

function WorkspaceInner({ boardId }: { boardId: string }) {
  const board = useBoard(boardId);
  const { state, dispatch, mode, setMode, hierarchy, visible, collapsed } = board;
  const { setCenter, getNode, getZoom } = useReactFlow();
  const agent = useResearchAgent(boardId, dispatch);

  // Engagement tracking: a research session starts when the board is opened.
  const [session, setSessionInfo] = useState(() => lastSession(boardId));
  useEffect(() => {
    boardOpened(boardId);
    // Opening may start a new session; show it (external store read once per open).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSessionInfo(lastSession(boardId));
    return () => boardClosed(boardId);
  }, [boardId]);
  const markComplete = () => {
    completeSession(boardId);
    setSessionInfo(lastSession(boardId));
    dispatch({ type: "log", message: "Research marked complete" });
  };
  const busy = useMemo(() => new Set(agent.active.keys()), [agent.active]);
  // Follow-up question id -> the node it was asked from (drives the inline input's loading state).
  const [followUps, setFollowUps] = useState<ReadonlyMap<string, string>>(new Map());
  /**
   * Question explorer parents: the stable `parentQuestionId` stamped when a question is created.
   * Boards saved before that field existed fall back to the nearest question ancestor in the
   * research hierarchy (which never includes manual arrows).
   */
  const questionParents = useMemo(() => {
    const questions = new Set(state.nodes.filter((n) => n.type === "question").map((n) => n.id));
    const out = new Map<string, string | undefined>();
    for (const n of state.nodes) {
      if (n.type !== "question") continue;
      let p = n.data.parentQuestionId;
      if (!p && !n.id.endsWith(":root")) p = ancestors(hierarchy, n.id).find((a) => questions.has(a));
      out.set(n.id, p && p !== n.id && questions.has(p) ? p : undefined);
    }
    return out;
  }, [state.nodes, hierarchy]);
  const [connectMode, setConnectMode] = useState(false);

  // Contextual images: fetched per node, independently of the research stream.
  const imageJobs = useRef(new Set<string>());
  useEffect(() => {
    for (const n of state.nodes) {
      const d = n.data;
      if (!d.imageQuery || d.generating || imageJobs.current.has(n.id)) continue;
      if (d.imageStatus !== "pending" && d.imageStatus !== "loading") continue;
      imageJobs.current.add(n.id);
      dispatch({ type: "setImage", nodeId: n.id, data: { imageStatus: "loading" } });
      // Never reuse a picture another node already shows.
      const used = new Set(state.nodes.map((m) => m.data.imageUrl).filter((u): u is string => !!u));
      void findImage(d.imageQuery, used)
        .catch(() => null)
        .then((found) =>
          dispatch({
            type: "setImage",
            nodeId: n.id,
            data: found ? { ...found, imageStatus: "ready" } : { imageStatus: "none" },
          }),
        );
    }
  }, [state.nodes, dispatch]);

  /**
   * Run a user action on a node. The server keeps no board state, so the
   * request carries just enough context: the node, its path to the root, its
   * existing children, the branch (for gaps) and already-known source URLs.
   */
  /** User guidance on a node and its ancestors, root first. */
  const guidanceFor = (nodeId: string) =>
    [...ancestors(hierarchy, nodeId).reverse(), nodeId]
      .map((id) => state.nodes.find((n) => n.id === id))
      .map((n) => (n?.type === "question" ? n.data.context?.trim() : undefined))
      .filter((c): c is string => !!c);

  const knownSourcesOf = () => {
    const known: Record<string, string> = {};
    for (const n of state.nodes) if (n.type === "source" && n.data.url) known[n.data.url] = n.id;
    return known;
  };

  /** The research question that owns a node: the node itself if it is a question, else its nearest question ancestor. */
  const owningQuestion = (nodeId: string) =>
    [nodeId, ...ancestors(hierarchy, nodeId)].find((id) => state.nodes.find((n) => n.id === id)?.type === "question");

  /** A new question under an existing one, researched on its own (parent context only). */
  const askFollowUp = (parentId: string, question: string) => {
    const parent = state.nodes.find((n) => n.id === parentId);
    if (!parent || !question.trim()) return;
    const questionId = `fq-${crypto.randomUUID().slice(0, 8)}`;
    setFollowUps((m) => new Map(m).set(questionId, parentId));
    const label = (id: string) => state.nodes.find((n) => n.id === id)?.data.label ?? "";
    const request: ActionRequest = {
      kind: "followUp",
      actionId: `followUp-${crypto.randomUUID().slice(0, 8)}`,
      target: {
        id: questionId,
        kind: "question",
        label: question.trim(),
        // What the follow-up is asked about (a question, or a claim's statement).
        description: parent.data.description ? `${parent.data.label} — ${parent.data.description}` : undefined,
        path: [...ancestors(hierarchy, parentId).reverse().map(label), parent.data.label],
        children: [],
        parentId,
        questionId: owningQuestion(parentId),
        context: guidanceFor(parentId),
      },
      knownSources: knownSourcesOf(),
    };
    if (collapsed.has(parentId)) dispatch({ type: "toggleCollapse", nodeId: parentId });
    dispatch({ type: "log", message: `Follow-up asked: “${question.trim()}”` });
    void agent.runAction(parent.data.researchId ?? "board", request);
  };

  const runNodeAction = (nodeId: string, kind: NodeAction) => {
    const node = state.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const byId = new Map(state.nodes.map((n) => [n.id, n]));
    const label = (id: string) => byId.get(id)?.data.label ?? "";
    const verificationOf = (id: string) => {
      const n = byId.get(id);
      return n?.type === "claim" ? n.data.verification : undefined;
    };
    const knownSources = knownSourcesOf();

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
        context: guidanceFor(node.id),
        questionId: owningQuestion(node.id),
      },
      knownSources,
    };
    // Expand the node so the new results are visible as they stream in.
    if (collapsed.has(node.id)) dispatch({ type: "toggleCollapse", nodeId: node.id });
    void agent.runAction(node.data.researchId ?? "board", request);
  };
  const selected = state.nodes.find((n) => n.selected) ?? null;
  // Active viewing time of the node whose details are open (paused when the tab is inactive).
  const selectedId = selected?.id ?? null;
  useEffect(() => viewNode(boardId, selectedId), [boardId, selectedId]);

  const [sidebarOpen, setSidebarOpen] = usePersistentState("rabbithole:sidebar-open", true);
  const [detailsOpen, setDetailsOpen] = usePersistentState("rabbithole:details-open", true);
  const [focusMode, setFocusMode] = usePersistentState("rabbithole:focus-mode", false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const isMobile = useIsMobile();
  // Phones: the research panel is a drawer over the canvas, closed by default.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const showSidebar = isMobile ? drawerOpen : sidebarOpen && !focusMode;
  const detailsWidth = isMobile || !selected || focusMode ? 0 : detailsOpen ? 320 : 44;

  const centerOn = useCallback(
    (id: string) => {
      const node = getNode(id);
      if (!node) return;
      const w = node.measured?.width ?? 0;
      const h = node.measured?.height ?? 0;
      const zoom = Math.max(getZoom(), 0.7);
      // Phones: the details sheet covers the lower half, so centre the node in the upper part.
      const shift = window.matchMedia("(max-width: 767px)").matches ? (window.innerHeight * 0.24) / zoom : 0;
      setCenter(node.position.x + w / 2, node.position.y + h / 2 + shift, { duration: 500, zoom });
    },
    [getNode, getZoom, setCenter],
  );

  /** Select a node, unfolding its branch if needed, and bring it into view. */
  const focusNode = useCallback(
    (id: string) => {
      nodeSelected(boardId, id);
      dispatch({ type: "select", nodeId: id });
      if (visible.has(id)) return centerOn(id);
      const unfold = new Set(ancestors(hierarchy, id));
      dispatch({ type: "setCollapsed", nodeIds: state.collapsed.filter((c) => !unfold.has(c)) });
      setTimeout(() => centerOn(id), 650);
    },
    [dispatch, visible, hierarchy, state.collapsed, centerOn, boardId],
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

  // Opened from the home page with a question: start researching right away.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q")?.trim();
    if (!q || autoStarted.has(boardId)) return;
    autoStarted.add(boardId);
    window.history.replaceState(null, "", window.location.pathname);
    startResearch(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  const openResearchInput = useCallback(() => {
    setFocusMode(false);
    setSidebarOpen(true);
    setDrawerOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [setFocusMode, setSidebarOpen]);

  const selectedEdge = selected ? null : state.edges.find((e) => e.selected);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        if (board.undo()) e.preventDefault();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        // Deleting a node keeps its research descendants as detached nodes.
        if (selected) board.deleteNode(selected.id);
        else if (selectedEdge) board.commit({ type: "deleteEdges", edgeIds: [selectedEdge.id] });
        else return;
        e.preventDefault();
      } else if (e.key === "n") {
        board.addNoteAtCenter();
        e.preventDefault();
      } else if (e.key === "c") {
        setConnectMode((c) => !c);
      } else if (e.key === "/") {
        e.preventDefault();
        openResearchInput();
      } else if (e.key === "f") {
        setFocusMode((f) => !f);
      } else if (e.key === "[") {
        setSidebarOpen((o) => !o);
      } else if (e.key === "Escape") {
        if (connectMode) setConnectMode(false);
        else if (selected || selectedEdge) dispatch({ type: "select", nodeId: null });
        else setFocusMode(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, selectedEdge, connectMode, board, dispatch, openResearchInput, setFocusMode, setSidebarOpen]);

  const toggleBranch = (id: string) => dispatch({ type: "toggleCollapse", nodeId: id });

  /**
   * Clearing the board never silently stops research: runs in progress keep
   * streaming, and everything they produced so far is restored onto the new board.
   */
  const resetBoard = () => {
    if (!agent.anyActive) return board.resetDemo();
    board.newBoard(agent.research?.question ?? "Untitled research");
    dispatch({ type: "stream", ops: agent.activeOps() });
  };
  const folded = state.collapsed.length > 0;

  const details = selected && (
            <NodeDetails
              key={selected.id}
              node={selected}
              nodes={state.nodes}
              edges={state.edges}
              branch={{
                children: hierarchy.children.get(selected.id)?.length ?? 0,
                collapsed: collapsed.has(selected.id),
                hidden: collapsed.has(selected.id) ? descendants(hierarchy, selected.id).length : 0,
                descendants: descendants(hierarchy, selected.id).length,
              }}
              researchDepth={hierarchy.researchDepth.get(selected.id) ?? 0}
              pinned={!!state.pinned[mode][selected.id]}
              onSelect={focusNode}
              onCenter={() => centerOn(selected.id)}
              onToggleBranch={() => toggleBranch(selected.id)}
              onUnpin={() => board.unpin([selected.id])}
              onEdit={() => {
                centerOn(selected.id);
                board.setEditing(selected.id);
              }}
              onDelete={(withBranch) => board.deleteNode(selected.id, withBranch)}
              investigate={{
                active: agent.active.get(selected.id),
                note: agent.notes[selected.id],
                onRun: (kind) => runNodeAction(selected.id, kind),
                onFollowUp: (q) => askFollowUp(selected.id, q),
                followUpBusy: [...agent.active.keys()].some((k) => followUps.get(k) === selected.id),
                onSetContext: (context) =>
                  board.commit({ type: "editNode", nodeId: selected.id, edit: { context: context || undefined } }),
              }}
              onCollapsePanel={() => setDetailsOpen(false)}
              onClose={() => dispatch({ type: "select", nodeId: null })}
              mobile={isMobile}
            />
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <header
        className="flex h-12 shrink-0 items-center gap-1 border-b border-white/[0.06] px-2 md:grid md:grid-cols-[1fr_auto_1fr] md:gap-3"
        style={isMobile ? { paddingTop: "env(safe-area-inset-top)", height: "calc(3rem + env(safe-area-inset-top))" } : undefined}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            className="hidden md:inline-flex"
            aria-label={showSidebar ? "Hide sidebar" : "Show sidebar"}
            title={showSidebar ? "Hide sidebar ([)" : "Show sidebar ([)"}
            onClick={() => (focusMode ? openResearchInput() : setSidebarOpen(!sidebarOpen))}
          >
            {showSidebar ? <PanelLeftClose /> : <PanelLeftOpen />}
          </Button>
          <Link
            href="/boards"
            title="Back to Boards"
            aria-label="Back to Boards"
            className="flex h-9 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground md:h-7"
          >
            <ArrowLeft className="size-4 md:size-3.5" />
            <span className="hidden sm:inline">Boards</span>
          </Link>
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

        <div className="flex shrink-0 items-center gap-2">
          <div className="hidden md:block">
            <LayoutSwitch mode={mode} onChange={setMode} />
          </div>
          <AgentStatus research={agent.research} running={agent.running} error={agent.error} />
          {agent.anyActive && (
            <Button
              variant="ghost"
              size="xs"
              className="hidden text-muted-foreground hover:text-rose-300 md:inline-flex"
              title="Stop all research in progress"
              onClick={agent.cancel}
            >
              <Square className="size-3" /> Cancel
            </Button>
          )}
          <div className="hidden lg:block">
            <CostIndicator usage={agent.usage} />
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-1">
          {isMobile ? null : session?.completedAt ? (
            <span
              className="hidden items-center gap-1 rounded-md px-2 text-xs text-emerald-300/90 md:flex"
              title="You marked this research complete. Reopening the board later starts a new session."
            >
              <CircleCheck className="size-3.5" /> Completed · {formatDuration(session.activeMs)}
            </span>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              title="Finish this research session (records your active time; separate from the AI finishing)"
              onClick={markComplete}
            >
              <CircleCheck />
              <span className="hidden md:inline">Mark Research Complete</span>
            </Button>
          )}
          <Button
            variant={focusMode ? "secondary" : "ghost"}
            size="sm"
            className="hidden md:inline-flex"
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
                  {isMobile && (
                    <>
                      <MenuItem icon={MessageSquarePlus} onClick={openResearchInput}>
                        Ask a research question
                      </MenuItem>
                      <MenuItem icon={mode === "sun" ? Network : Sun} onClick={() => setMode(mode === "sun" ? "tree" : "sun")}>
                        {mode === "sun" ? "Switch to Tree layout" : "Switch to Sun layout"}
                      </MenuItem>
                      {!session?.completedAt && (
                        <MenuItem icon={CircleCheck} onClick={markComplete}>
                          Mark Research Complete
                        </MenuItem>
                      )}
                      {agent.anyActive && (
                        <MenuItem icon={Square} onClick={agent.cancel}>
                          Cancel research
                        </MenuItem>
                      )}
                      <Menu.Separator className="my-1 h-px bg-white/[0.08]" />
                    </>
                  )}
                  <MenuItem icon={Maximize} onClick={board.fit}>Fit to view</MenuItem>
                  <MenuItem icon={LayoutDashboard} onClick={() => board.unpin("all")}>
                    Tidy layout
                  </MenuItem>
                  <MenuItem icon={folded ? UnfoldVertical : FoldVertical} onClick={folded ? board.expandAll : board.collapseToBranches}>
                    {folded ? "Expand all branches" : "Collapse to main branches"}
                  </MenuItem>
                  <Menu.Separator className="my-1 h-px bg-white/[0.08]" />
                  <MenuItem icon={RotateCcw} onClick={resetBoard}>
                    {agent.anyActive ? "Clear board (keeps active research)" : "Reset demo board"}
                  </MenuItem>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {isMobile && drawerOpen && (
          <div className="absolute inset-0 z-30 bg-black/50" onClick={() => setDrawerOpen(false)} aria-hidden />
        )}
        <aside
          aria-label="Research"
          aria-hidden={!showSidebar}
          inert={!showSidebar}
          className={cn(
            "shrink-0 overflow-hidden bg-sidebar/60 transition-[width] duration-300 ease-out",
            showSidebar && "border-r border-white/[0.06]",
            isMobile && "absolute inset-y-0 left-0 z-40 bg-sidebar/95 backdrop-blur-xl",
          )}
          style={{ width: showSidebar ? (isMobile ? "min(320px, 88vw)" : 288) : 0 }}
        >
          <ResearchSidebar
            nodes={state.nodes}
            questionParents={questionParents}
            activity={state.activity}
            selectedId={selected?.id ?? null}
            inputRef={inputRef}
            onAddQuestion={(q) => {
              setDrawerOpen(false);
              startResearch(q);
            }}
            busy={agent.running}
            onSelect={(id) => {
              setDrawerOpen(false);
              focusNode(id);
            }}
          />
        </aside>

        <main className="relative min-w-0 flex-1">
          <BoardCanvas
            onUserSelect={(id) => nodeSelected(boardId, id)}
            board={board}
            busy={busy}
            connectMode={connectMode}
            onToggleConnect={() => setConnectMode((c) => !c)}
            onAskQuestion={openResearchInput}
          />
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
          {selected && detailsOpen && !isMobile && details}
        </aside>
      </div>

      {isMobile && (
        <BottomSheet
          label="Node details"
          open={!!selected}
          onClose={() => dispatch({ type: "select", nodeId: null })}
        >
          {details}
        </BottomSheet>
      )}
    </div>
  );
}

export default function Workspace({ boardId }: { boardId: string }) {
  return (
    <ReactFlowProvider>
      <WorkspaceInner key={boardId} boardId={boardId} />
    </ReactFlowProvider>
  );
}
