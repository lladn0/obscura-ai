"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useReactFlow, type XYPosition } from "@xyflow/react";

import { boardReducer, emptyBoard, loadBoard, saveBoard, type BoardState } from "./board-state";
import { createDemoBoard } from "./demo";
import { buildHierarchy, defaultCollapsed, visibleIds, type Hierarchy } from "./hierarchy";
import { computeLayout, LAYOUT_MODES, type LayoutMode } from "./layout";

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
  const { fitView } = useReactFlow();

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
  const structureKey = [
    state.nodes.map((n) => `${n.id}:${n.type}`).join(","),
    state.edges.map((e) => `${e.source}>${e.target}`).join(","),
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
    (nodeIds: string[]) => {
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

  const resetDemo = useCallback(() => {
    stopAnimation();
    shownRef.current = null;
    fitNext.current = true;
    dispatch({ type: "replace", state: createDemoBoard() });
    setGeneration((g) => g + 1);
  }, [stopAnimation]);

  /** Start a fresh, empty board (used when research begins from the demo board). */
  const newBoard = useCallback(
    (title: string) => {
      stopAnimation();
      shownRef.current = null;
      fitNext.current = true;
      dispatch({ type: "replace", state: { ...emptyBoard, title, pinned: { sun: {}, tree: {} } } });
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
    fit: useCallback(() => fitView(FIT), [fitView]),
  };
}

export type Board = ReturnType<typeof useBoard>;
