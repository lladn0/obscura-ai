"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useReactFlow, type XYPosition } from "@xyflow/react";

import { boardReducer, emptyBoard, loadBoard, saveBoard, type BoardAction, type BoardState } from "./board-state";
import { createDemoBoard } from "./demo";
import { buildHierarchy, defaultCollapsed, descendants, visibleIds, type Hierarchy } from "./hierarchy";
import { computeLayout, LAYOUT_MODES, sizeOf, type LayoutMode } from "./layout";
import type { ResearchNode } from "./types";

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

const MODE_KEY = "rabbithole:layout-mode";
const FIT = { padding: 0.15, duration: 500, maxZoom: 1 };

function loadMode(): LayoutMode {
  try {
    const saved = localStorage.getItem(MODE_KEY);
    return LAYOUT_MODES.includes(saved as LayoutMode) ? (saved as LayoutMode) : "sun";
  } catch {
    return "sun";
  }
}

/**
 * Final position of every visible node: the auto-layout slot, unless the user
 * pinned it there by dragging. Descendants of a pinned node keep the same
 * offset so a dragged branch moves as one.
 */
function layoutTargets(state: BoardState, mode: LayoutMode, h: Hierarchy, visible: Set<string>) {
  const auto = computeLayout(mode, state.nodes, h, visible);
  const pins = state.pinned[mode];
  const targets = new Map<string, XYPosition>();
  const walk = (id: string, offset: XYPosition) => {
    const base = auto.get(id);
    if (!base) return;
    const pin = pins[id];
    targets.set(id, pin ?? { x: base.x + offset.x, y: base.y + offset.y });
    // The root moves alone; other pinned nodes carry their branch with them.
    const next = pin && id !== h.rootId ? { x: pin.x - base.x, y: pin.y - base.y } : offset;
    for (const c of h.children.get(id)!) if (visible.has(c)) walk(c, next);
  };
  if (h.rootId) walk(h.rootId, { x: 0, y: 0 });
  return targets;
}

type Rect = { x: number; y: number; w: number; h: number };
const CLEARANCE = 24;
const hits = (a: Rect, b: Rect) =>
  a.x < b.x + b.w + CLEARANCE && b.x < a.x + a.w + CLEARANCE && a.y < b.y + b.h + CLEARANCE && b.y < a.y + a.h + CLEARANCE;

/**
 * Floating notes that a newly revealed branch would land on move the minimum
 * distance needed to clear it. Notes that are not hit never move, and notes
 * sitting right next to a moved note travel with it, so small groups stay together.
 */
function clearNotes(nodes: ResearchNode[], incoming: Rect[]): Map<string, { x: number; y: number }> {
  const moved = new Map<string, { x: number; y: number }>();
  if (!incoming.length) return moved;
  const notes = nodes.filter((n) => n.type === "note");
  const rectOf = (n: ResearchNode): Rect => {
    const { width, height } = sizeOf(n);
    return { x: n.position.x, y: n.position.y, w: width, h: height };
  };
  for (const note of notes) {
    if (moved.has(note.id)) continue;
    const r = rectOf(note);
    let dx = 0;
    let dy = 0;
    for (let i = 0; i < 8; i++) {
      const cur = { ...r, x: r.x + dx, y: r.y + dy };
      const block = incoming.find((b) => hits(cur, b));
      if (!block) break;
      // Smallest push out of the obstructing card, along one axis.
      const options = [
        { dx: block.x - CLEARANCE - (cur.x + cur.w), dy: 0 },
        { dx: block.x + block.w + CLEARANCE - cur.x, dy: 0 },
        { dx: 0, dy: block.y - CLEARANCE - (cur.y + cur.h) },
        { dx: 0, dy: block.y + block.h + CLEARANCE - cur.y },
      ].sort((a, b) => Math.abs(a.dx) + Math.abs(a.dy) - (Math.abs(b.dx) + Math.abs(b.dy)));
      dx += options[0].dx;
      dy += options[0].dy;
    }
    if (!dx && !dy) continue;
    moved.set(note.id, { x: r.x + dx, y: r.y + dy });
    // Neighbouring notes (a manual group) keep their placement relative to this one.
    for (const other of notes) {
      if (other.id === note.id || moved.has(other.id)) continue;
      if (hits(rectOf(other), r)) moved.set(other.id, { x: other.position.x + dx, y: other.position.y + dy });
    }
  }
  return moved;
}

const MAX_UNDO = 40;
/** User edits that can be undone with Ctrl/Cmd+Z. */
const UNDOABLE = new Set<BoardAction["type"]>(["addNote", "editNode", "deleteNodes", "deleteEdges", "connect", "editEdge"]);

/**
 * Board state, layout and persistence. Client-only (reads localStorage while
 * initialising) and must be rendered inside a ReactFlowProvider.
 */
export function useBoard() {
  const [state, dispatch] = useReducer(
    boardReducer,
    undefined,
    (): BoardState => loadBoard() ?? createDemoBoard(),
  );
  const [mode, setModeState] = useState<LayoutMode>(loadMode);
  /** Bumped when the board is replaced wholesale, to force a fresh layout. */
  const [generation, setGeneration] = useState(0);
  const { fitView, screenToFlowPosition } = useReactFlow();
  /** Node being edited in place (transient, not persisted). */
  const [editingId, setEditing] = useState<string | null>(null);

  const stateRef = useRef(state);
  const modeRef = useRef(mode);
  useEffect(() => {
    stateRef.current = state;
    modeRef.current = mode;
    const timer = setTimeout(() => saveBoard(state), 250);
    return () => clearTimeout(timer);
  }, [state, mode]);

  // The tree only depends on which nodes/edges exist, not on positions, so it
  // is rebuilt on structural changes rather than every animation frame.
  // Notes and manual links never affect the research tree, so they don't re-flow it.
  const structureKey = [
    state.nodes.filter((n) => n.type !== "note").map((n) => `${n.id}:${n.type}`).join(","),
    state.edges.filter((e) => !e.data?.manual).map((e) => `${e.source}>${e.target}`).join(","),
  ].join("|");
  const hierarchy = useMemo(
    () => buildHierarchy(state.nodes, state.edges),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [structureKey],
  );
  const collapsed = useMemo(() => new Set(state.collapsed), [state.collapsed]);
  const visible = useMemo(() => visibleIds(hierarchy, collapsed), [hierarchy, collapsed]);

  // --- Animation -----------------------------------------------------------

  const frame = useRef<number | null>(null);
  const stopAnimation = useCallback(() => {
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);

  /** Tween nodes to new positions so edges follow smoothly. */
  const animateTo = useCallback(
    (targets: Map<string, XYPosition>, from: Map<string, XYPosition>, onDone?: () => void, duration = 600) => {
      stopAnimation();
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        const k = ease(t);
        const positions = new Map<string, XYPosition>();
        for (const [id, to] of targets) {
          const a = from.get(id) ?? to;
          positions.set(id, { x: a.x + (to.x - a.x) * k, y: a.y + (to.y - a.y) * k });
        }
        dispatch({ type: "setPositions", positions });
        if (t < 1) frame.current = requestAnimationFrame(step);
        else {
          frame.current = null;
          onDone?.();
        }
      };
      frame.current = requestAnimationFrame(step);
    },
    [stopAnimation],
  );

  // --- Layout --------------------------------------------------------------

  const shownRef = useRef<Set<string> | null>(null);
  // A newer relayout can interrupt an animation that was going to fit the view; keep the request.
  const pendingFit = useRef(false);

  const relayout = useCallback(
    ({ fit = false }: { fit?: boolean } = {}) => {
      const s = stateRef.current;
      const m = modeRef.current;
      const h = buildHierarchy(s.nodes, s.edges);
      const vis = visibleIds(h, new Set(s.collapsed));
      const targets = layoutTargets(s, m, h, vis);

      const from = new Map(s.nodes.map((n) => [n.id, n.position]));
      // Nodes that just appeared (expanded branch, new research) grow out of their parent.
      const shown = shownRef.current;
      if (shown) {
        const walk = (id: string) => {
          const parent = h.parent.get(id);
          if (!shown.has(id) && parent && !s.pinned[m][id]) from.set(id, from.get(parent)!);
          for (const c of h.children.get(id)!) if (vis.has(c)) walk(c);
        };
        if (h.rootId) walk(h.rootId);
      }
      shownRef.current = vis;

      // Newly revealed research cards push aside floating notes they would cover.
      if (shown) {
        const incoming: Rect[] = [];
        const byId = new Map(s.nodes.map((n) => [n.id, n]));
        for (const [id, p] of targets) {
          if (shown.has(id)) continue;
          const { width, height } = sizeOf(byId.get(id)!);
          incoming.push({ x: p.x, y: p.y, w: width, h: height });
        }
        for (const [id, p] of clearNotes(s.nodes, incoming)) targets.set(id, p);
      }

      pendingFit.current ||= fit;
      animateTo(targets, from, () => {
        if (pendingFit.current) fitView(FIT);
        pendingFit.current = false;
      });
    },
    [animateTo, fitView],
  );

  // Structural changes (mode, collapse, new or removed nodes/edges) re-flow immediately.
  const layoutKey = `${generation}|${mode}|${structureKey}|${state.collapsed.join(",")}`;
  const lastMode = useRef<LayoutMode | null>(null);
  const fitNext = useRef(false);
  useEffect(() => {
    const fit = lastMode.current !== modeRef.current || fitNext.current;
    lastMode.current = modeRef.current;
    fitNext.current = false;
    relayout({ fit });
  }, [layoutKey, relayout]);

  // Size changes (first measurement, expanded descriptions) re-flow once they settle.
  const sizeKey = state.nodes
    .filter((n) => visible.has(n.id))
    .map((n) => `${Math.round((n.measured?.width ?? 0) / 8)}x${Math.round((n.measured?.height ?? 0) / 8)}`)
    .join(",");
  const sizeKeyRef = useRef(sizeKey);
  useEffect(() => {
    if (sizeKeyRef.current === sizeKey) return;
    sizeKeyRef.current = sizeKey;
    // Streaming text changes sizes constantly; re-flow only once it pauses.
    const timer = setTimeout(() => relayout(), 350);
    return () => clearTimeout(timer);
  }, [sizeKey, relayout]);

  // --- Actions -------------------------------------------------------------

  const setMode = useCallback((next: LayoutMode) => {
    setModeState(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // Preference only; ignore unavailable storage.
    }
  }, []);

  const pinDragged = useCallback(
    (dragged: string[]) => {
      // Notes are free-floating: their position is simply their node position.
      const nodeIds = dragged.filter((id) => stateRef.current.nodes.find((n) => n.id === id)?.type !== "note");
      if (!nodeIds.length) return;
      dispatch({ type: "pin", mode: modeRef.current, nodeIds });
      // Let the dragged node's branch follow it.
      requestAnimationFrame(() => relayout());
    },
    [relayout],
  );

  const unpin = useCallback(
    (nodeIds: string[] | "all") => {
      dispatch({ type: "unpin", mode: modeRef.current, nodeIds });
      requestAnimationFrame(() => relayout({ fit: nodeIds === "all" }));
    },
    [relayout],
  );

  const expandAll = useCallback(() => dispatch({ type: "setCollapsed", nodeIds: [] }), []);
  const collapseToBranches = useCallback(
    () => dispatch({ type: "setCollapsed", nodeIds: defaultCollapsed(hierarchy) }),
    [hierarchy],
  );

  // --- Editing with undo -----------------------------------------------------

  const history = useRef<BoardState[]>([]);
  const commit = useCallback((action: BoardAction) => {
    if (UNDOABLE.has(action.type)) {
      history.current = [...history.current.slice(-(MAX_UNDO - 1)), stateRef.current];
    }
    dispatch(action);
  }, []);

  /**
   * Restore the board before the last edit. Research that streamed in since
   * then is kept: only the user's own change is rolled back.
   */
  const undo = useCallback(() => {
    const prev = history.current.pop();
    if (!prev) return false;
    stopAnimation();
    const cur = stateRef.current;
    const had = new Set(prev.nodes.map((n) => n.id));
    const hadEdge = new Set(prev.edges.map((e) => e.id));
    const newResearch = cur.nodes.filter((n) => !had.has(n.id) && n.type !== "note");
    const newEdges = cur.edges.filter((e) => !hadEdge.has(e.id) && !e.data?.manual);
    const positions = new Map(cur.nodes.map((n) => [n.id, n.position]));
    dispatch({
      type: "replace",
      state: {
        ...cur,
        nodes: [...prev.nodes.map((n) => ({ ...n, position: positions.get(n.id) ?? n.position })), ...newResearch],
        edges: [...prev.edges, ...newEdges],
        collapsed: cur.collapsed,
        pinned: prev.pinned,
        deleted: prev.deleted,
      },
    });
    return true;
  }, [stopAnimation]);

  const addNote = useCallback(
    (position: XYPosition) => {
      const nodeId = `note-${crypto.randomUUID().slice(0, 8)}`;
      commit({ type: "addNote", nodeId, position });
      return nodeId;
    },
    [commit],
  );

  /** New note at the centre of the visible canvas, ready to type into. */
  const addNoteAtCenter = useCallback(() => {
    const pane = document.querySelector(".rh-board")?.getBoundingClientRect();
    const center = pane
      ? screenToFlowPosition({ x: pane.left + pane.width / 2, y: pane.top + pane.height / 2 })
      : { x: 0, y: 0 };
    // Nudge so several new notes don't stack exactly on top of each other.
    const jitter = (Math.random() - 0.5) * 40;
    const id = addNote({ x: center.x - 110 + jitter, y: center.y - 40 + jitter });
    setEditing(id);
  }, [addNote, screenToFlowPosition]);

  /** Delete a node. Its research descendants stay (detached) unless `withBranch`. */
  const deleteNode = useCallback(
    (id: string, withBranch = false) => {
      const h = buildHierarchy(stateRef.current.nodes, stateRef.current.edges);
      commit({ type: "deleteNodes", nodeIds: withBranch ? [id, ...descendants(h, id)] : [id] });
    },
    [commit],
  );

  const resetDemo = useCallback(() => {
    stopAnimation();
    shownRef.current = null;
    fitNext.current = true;
    history.current = [];
    dispatch({ type: "replace", state: createDemoBoard() });
    setGeneration((g) => g + 1);
  }, [stopAnimation]);

  /** Start a fresh, empty board (used when research begins from the demo board). */
  const newBoard = useCallback(
    (title: string) => {
      stopAnimation();
      shownRef.current = null;
      fitNext.current = true;
      // The user's own notes (and links between them) survive starting new research.
      const s = stateRef.current;
      const notes = s.nodes.filter((n) => n.type === "note" && !n.data.demo);
      const ids = new Set(notes.map((n) => n.id));
      const links = s.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
      history.current = [];
      dispatch({
        type: "replace",
        state: { ...emptyBoard, title, nodes: notes, edges: links, pinned: { sun: {}, tree: {} }, deleted: [] },
      });
      setGeneration((g) => g + 1);
    },
    [stopAnimation],
  );

  return {
    state,
    newBoard,
    dispatch,
    mode,
    setMode,
    hierarchy,
    visible,
    collapsed,
    stopAnimation,
    pinDragged,
    unpin,
    expandAll,
    collapseToBranches,
    resetDemo,
    commit,
    undo,
    addNote,
    addNoteAtCenter,
    deleteNode,
    editingId,
    setEditing,
    fit: useCallback(() => fitView(FIT), [fitView]),
  };
}

export type Board = ReturnType<typeof useBoard>;
