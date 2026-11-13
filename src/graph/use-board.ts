"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import type { XYPosition } from "@xyflow/react";

import { boardReducer, loadBoard, saveBoard, type BoardState } from "./board-state";
import { createDemoBoard } from "./demo";
import { computeLayout } from "./layout";

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Board state + persistence. Must run client-side only (reads localStorage
 * during initialisation).
 */
export function useBoard() {
  const [state, dispatch] = useReducer(
    boardReducer,
    undefined,
    (): BoardState => loadBoard() ?? createDemoBoard(),
  );

  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
    const timer = setTimeout(() => saveBoard(state), 250);
    return () => clearTimeout(timer);
  }, [state]);

  const frame = useRef<number | null>(null);

  /** Tween nodes to new positions so edges follow smoothly. */
  const animateTo = useCallback(
    (targets: Map<string, XYPosition>, onDone?: () => void, duration = 550) => {
      if (frame.current) cancelAnimationFrame(frame.current);
      const from = new Map(stateRef.current.nodes.map((n) => [n.id, n.position]));
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
    [],
  );

  const relayout = useCallback(
    (onDone?: () => void) => {
      const { nodes, edges } = stateRef.current;
      animateTo(computeLayout(nodes, edges), onDone);
      dispatch({ type: "log", message: "Re-arranged board with auto-layout" });
    },
    [animateTo],
  );

  const resetDemo = useCallback(() => {
    if (frame.current) cancelAnimationFrame(frame.current);
    dispatch({ type: "replace", state: createDemoBoard() });
  }, []);

  return { state, dispatch, relayout, resetDemo };
}
