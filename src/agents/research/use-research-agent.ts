"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch } from "react";
import { useAgent } from "@copilotkit/react-core/v2";

import type { BoardAction, StreamOp } from "@/graph/board-state";
import {
  GraphEvent,
  RESEARCH_AGENT_ID,
  type EdgeCreated,
  type NodeCompleted,
  type NodeCreated,
  type NodeText,
  type ResearchRunProps,
  type ResearchState,
} from "./protocol";

/**
 * Connects the board to the research agent over AG-UI (via CopilotKit).
 * Graph events are queued and flushed once per animation frame, so dozens of
 * text chunks from parallel branches become a single board update.
 */
export function useResearchAgent(dispatch: Dispatch<BoardAction>) {
  // Re-renders are driven by our own state below, not by every agent event.
  const { agent } = useAgent({ agentId: RESEARCH_AGENT_ID, updates: [] });
  const [research, setResearch] = useState<ResearchState | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queue = useRef<StreamOp[]>([]);
  const frame = useRef<number | null>(null);
  const lastSeq = useRef(new Map<string, number>());
  const branchStatus = useRef(new Map<string, string>());

  const flush = useCallback(() => {
    frame.current = null;
    const ops = queue.current;
    queue.current = [];
    if (ops.length) dispatch({ type: "stream", ops });
  }, [dispatch]);

  const enqueue = useCallback(
    (op: StreamOp) => {
      queue.current.push(op);
      frame.current ??= requestAnimationFrame(flush);
    },
    [flush],
  );

  useEffect(() => {
    const { unsubscribe } = agent.subscribe({
      onCustomEvent: ({ event }) => {
        switch (event.name) {
          case GraphEvent.NodeCreated: {
            const v = event.value as NodeCreated;
            enqueue({ op: "node", nodeId: v.nodeId, kind: v.kind, researchId: v.researchId, branchId: v.branchId, data: v.data });
            break;
          }
          case GraphEvent.NodeText: {
            const v = event.value as NodeText;
            // Per-node ordering: drop duplicates and anything older than what we applied.
            if (v.seq <= (lastSeq.current.get(v.nodeId) ?? 0)) break;
            lastSeq.current.set(v.nodeId, v.seq);
            enqueue({ op: "text", nodeId: v.nodeId, field: v.field, delta: v.delta });
            break;
          }
          case GraphEvent.NodeCompleted:
            enqueue({ op: "done", nodeId: (event.value as NodeCompleted).nodeId });
            break;
          case GraphEvent.EdgeCreated: {
            const v = event.value as EdgeCreated;
            enqueue({ op: "edge", edgeId: v.edgeId, source: v.source, target: v.target, relation: v.relation });
            break;
          }
        }
      },
      onStateChanged: ({ state }) => {
        const next = state as ResearchState;
        setResearch(next);
        for (const [id, b] of Object.entries(next.branches ?? {})) {
          if (b.status === "done" && branchStatus.current.get(id) !== "done")
            dispatch({ type: "log", message: `Branch researched: ${b.label}` });
          branchStatus.current.set(id, b.status);
        }
      },
      onRunErrorEvent: ({ event }) => setError(event.message),
      onRunFailed: ({ error }) => setError(error.message),
    });
    return () => unsubscribe();
  }, [agent, enqueue, dispatch]);

  const startResearch = useCallback(
    async (props: ResearchRunProps) => {
      setError(null);
      setRunning(true);
      lastSeq.current.clear();
      branchStatus.current.clear();
      dispatch({ type: "log", message: `Research started: “${props.question}”` });
      try {
        await agent.runAgent({ forwardedProps: props });
        dispatch({ type: "log", message: "Research completed" });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        dispatch({ type: "log", message: "Research failed" });
      } finally {
        flush();
        setRunning(false);
      }
    },
    [agent, dispatch, flush],
  );

  useEffect(() => () => void (frame.current && cancelAnimationFrame(frame.current)), []);

  return { research, running, error, startResearch };
}
