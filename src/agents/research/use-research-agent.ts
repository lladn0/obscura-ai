"use client";

import { useCallback, useEffect, useReducer, useRef, useState, type Dispatch } from "react";
import type { AbstractAgent } from "@ag-ui/client";
import type { AgentSubscriber } from "@ag-ui/client";
import { useAgent } from "@copilotkit/react-core/v2";

import { boardReducer, type BoardAction, type StreamOp } from "@/graph/board-state";
import { loadBoardById, saveBoardById, updateBoardMeta } from "@/graph/board-store";
import {
  ACTION_RESULT_EVENT,
  GraphEvent,
  RESEARCH_AGENT_ID,
  USAGE_EVENT,
  type ActionRequest,
  type ActionResult,
  type EdgeCreated,
  type NodeAction,
  type NodeCompleted,
  type NodeCreated,
  type NodeText,
  type ResearchRunProps,
  type ResearchState,
} from "./protocol";
import type { ResearchUsage } from "./graph";

export type UsageTotals = { llmCostUsd: number; llmRequests: number; inputTokens: number; outputTokens: number; firecrawlCredits: number };
const NO_USAGE: UsageTotals = { llmCostUsd: 0, llmRequests: 0, inputTokens: 0, outputTokens: 0, firecrawlCredits: 0 };

export type ActionNote = { kind: NodeAction; message: string; error?: boolean };

const ACTION_LABEL: Record<NodeAction, string> = {
  deepDive: "Deep Dive",
  challenge: "Challenge",
  findEvidence: "Find Evidence",
  gaps: "Research Gaps",
  followUp: "Follow-up",
};

/**
 * Research sessions live outside React: a run keeps going (and keeps its
 * accumulated graph operations) whatever happens to the canvas: layout
 * switches, re-renders, a remounted workspace or a cleared board. Only an
 * explicit cancel, a failure or the server stopping ends one.
 */
export type ResearchSession = {
  runId: string;
  researchId: string;
  /** The board the run writes into. */
  boardId: string;
  kind: "research" | NodeAction;
  status: "running" | "done" | "failed" | "cancelled";
  /** Every graph operation the run produced, so its results can be restored. */
  ops: StreamOp[];
  /** How many of `ops` already reached the board (live or in storage). */
  applied: number;
};
const sessions = new Map<string, ResearchSession>();
const sessionListeners = new Set<() => void>();
const setSession = (runId: string, patch: Partial<ResearchSession>) => {
  const cur = sessions.get(runId);
  if (cur) Object.assign(cur, patch);
  if (cur?.kind === "research" && patch.status)
    updateBoardMeta(cur.boardId, { research: patch.status === "running" ? "running" : patch.status === "failed" ? "failed" : "completed" });
  if (cur && patch.status && patch.status !== "running") persistSoon(cur.boardId);
  for (const l of sessionListeners) l();
};
const runningOn = (boardId: string, kind?: "research") =>
  [...sessions.values()].some((s) => s.boardId === boardId && s.status === "running" && (!kind || s.kind === kind));
/** True while research (or an action) is streaming into this board, in this browser tab. */
export const isBoardResearching = (boardId: string) => runningOn(boardId);

type CustomEventArg = Parameters<NonNullable<AgentSubscriber["onCustomEvent"]>>[0];

// --- Routing graph operations to boards ----------------------------------------------
// Runs outlive the workspace: while their board is open, operations stream into
// it; otherwise they are applied to the board's saved state, so navigating away
// (to Boards, Statistics, another board) never loses research.

type LiveBoard = { boardId: string; apply: (ops: StreamOp[]) => void };
let live: LiveBoard | null = null;
const lastSeq = new Map<string, number>();
const pendingFrames = new Map<string, number>();
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Apply operations not yet on the board: into the open board, or into storage. */
function deliver(boardId: string) {
  const pending = [...sessions.values()].filter((s) => s.boardId === boardId && s.applied < s.ops.length);
  if (!pending.length) return;
  const ops = pending.flatMap((s) => s.ops.slice(s.applied));
  if (live?.boardId === boardId) live.apply(ops);
  else {
    const saved = loadBoardById(boardId);
    if (!saved) return;
    saveBoardById(boardId, boardReducer(saved, { type: "stream", ops }));
  }
  for (const s of pending) s.applied = s.ops.length;
}

function persistSoon(boardId: string) {
  if (live?.boardId === boardId || persistTimers.has(boardId)) return;
  persistTimers.set(
    boardId,
    setTimeout(() => {
      persistTimers.delete(boardId);
      deliver(boardId);
    }, 1000),
  );
}

function routeOp(runId: string | null, op: StreamOp) {
  const session = runId ? sessions.get(runId) : null;
  if (!session) return;
  session.ops.push(op);
  if (live?.boardId === session.boardId) {
    // One board update per animation frame, however many parallel chunks arrive.
    const id = session.boardId;
    if (!pendingFrames.has(id)) pendingFrames.set(id, requestAnimationFrame(() => {
      pendingFrames.delete(id);
      deliver(id);
    }));
  } else persistSoon(session.boardId);
}

/** Graph events of any run (main research or action clone) -> board operations. */
function onGraphEvent({ event }: CustomEventArg, runId: string | null) {
  switch (event.name) {
    case GraphEvent.NodeCreated: {
      const v = event.value as NodeCreated;
      return routeOp(runId, { op: "node", nodeId: v.nodeId, kind: v.kind, researchId: v.researchId, branchId: v.branchId, data: v.data, collapsed: v.collapsed });
    }
    case GraphEvent.NodeText: {
      const v = event.value as NodeText;
      // Per-node ordering: drop duplicates and anything older than what we applied.
      if (v.seq <= (lastSeq.get(v.nodeId) ?? 0)) return;
      lastSeq.set(v.nodeId, v.seq);
      return routeOp(runId, { op: "text", nodeId: v.nodeId, field: v.field, delta: v.delta });
    }
    case GraphEvent.NodeCompleted: {
      const v = event.value as NodeCompleted;
      return routeOp(runId, { op: "done", nodeId: v.nodeId, data: v.data });
    }
    case GraphEvent.NodeRemoved:
      return routeOp(runId, { op: "remove", nodeId: (event.value as { nodeId: string }).nodeId });
    case GraphEvent.EdgeCreated: {
      const v = event.value as EdgeCreated;
      return routeOp(runId, { op: "edge", edgeId: v.edgeId, source: v.source, target: v.target, relation: v.relation });
    }
  }
}

/** Agent clones of runs in progress (module-level, so Cancel works after a remount). */
const runners = new Map<string, AbstractAgent>();

/**
 * Connects the board to the research agent over AG-UI (via CopilotKit).
 * Graph events are queued and flushed once per animation frame, so text
 * chunks from parallel branches and concurrent actions become one update.
 * Node actions run on their own agent clone (own thread), so several can
 * stream at once next to the main research.
 */
export function useResearchAgent(boardId: string, dispatch: Dispatch<BoardAction>) {
  // Re-renders are driven by our own state below, not by every agent event.
  const { agent } = useAgent({ agentId: RESEARCH_AGENT_ID, updates: [] });
  // This board receives its runs' operations live while mounted; anything that
  // streamed while it was closed is applied first.
  useEffect(() => {
    live = { boardId, apply: (ops) => dispatch({ type: "stream", ops }) };
    clearTimeout(persistTimers.get(boardId));
    persistTimers.delete(boardId);
    deliver(boardId);
    return () => {
      if (live?.boardId === boardId) live = null;
      persistSoon(boardId);
    };
  }, [boardId, dispatch]);
  const [research, setResearch] = useState<ResearchState | null>(null);
  // Derived from the session store, so a remounted workspace still knows a run is active.
  const [, refresh] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    sessionListeners.add(refresh);
    return () => void sessionListeners.delete(refresh);
  }, []);
  const running = runningOn(boardId, "research");
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageTotals>(NO_USAGE);
  const [active, setActive] = useState<ReadonlyMap<string, NodeAction>>(new Map());
  const [notes, setNotes] = useState<Readonly<Record<string, ActionNote>>>({});

  const branchStatus = useRef(new Map<string, string>());
  const activeRef = useRef(new Set<string>());

  /** Apply whatever streamed for this board right now (end of a run). */
  const flush = useCallback(() => deliver(boardId), [boardId]);

  /** Usage and result events for this workspace's UI (graph events are routed above). */
  const handleEvent = useCallback(
    ({ event }: CustomEventArg) => {
      switch (event.name) {
        case USAGE_EVENT: {
          const u = event.value as ResearchUsage;
          setUsage((t) =>
            u.kind === "llm"
              ? {
                  ...t,
                  llmCostUsd: t.llmCostUsd + u.costUsd,
                  llmRequests: t.llmRequests + 1,
                  inputTokens: t.inputTokens + u.input + u.cacheRead + u.cacheWrite,
                  outputTokens: t.outputTokens + u.output,
                }
              : { ...t, firecrawlCredits: t.firecrawlCredits + u.credits },
          );
          break;
        }
        case ACTION_RESULT_EVENT: {
          const r = event.value as ActionResult;
          setNotes((n) => ({ ...n, [r.nodeId]: { kind: r.kind, message: r.message } }));
          dispatch({ type: "log", message: `${ACTION_LABEL[r.kind]}: ${r.message}` });
          break;
        }
      }
    },
    [dispatch],
  );

  /**
   * Each research question runs on its own agent clone (own thread), like
   * node actions, so boards can research in parallel and a run is never tied
   * to the component that started it.
   */
  const startResearch = useCallback(
    async (props: ResearchRunProps) => {
      setError(null);
      setUsage(NO_USAGE);
      const runId = `run-${crypto.randomUUID().slice(0, 8)}`;
      const runner = agent.clone();
      runner.threadId = crypto.randomUUID();
      sessions.set(runId, { runId, researchId: props.researchId, boardId, kind: "research", status: "running", ops: [], applied: 0 });
      runners.set(runId, runner);
      setSession(runId, {});
      branchStatus.current.clear();
      dispatch({ type: "log", message: `Research started: “${props.question}”` });
      const sub = runner.subscribe({
        onCustomEvent: (arg: CustomEventArg) => {
          onGraphEvent(arg, runId);
          handleEvent(arg);
        },
        onStateChanged: ({ state }: { state: unknown }) => {
          const next = state as ResearchState;
          setResearch(next);
          for (const [id, b] of Object.entries(next.branches ?? {})) {
            if (b.status === "done" && branchStatus.current.get(id) !== "done")
              dispatch({ type: "log", message: `Branch researched: ${b.label}` });
            branchStatus.current.set(id, b.status);
          }
        },
        onRunErrorEvent: ({ event }: { event: { message: string } }) => setError(event.message),
      });
      try {
        await runner.runAgent({ forwardedProps: props });
        if (sessions.get(runId)?.status === "running") {
          setSession(runId, { status: "done" });
          dispatch({ type: "log", message: "Research completed" });
        }
      } catch (e) {
        if (sessions.get(runId)?.status !== "cancelled") {
          setSession(runId, { status: "failed" });
          setError(e instanceof Error ? e.message : String(e));
          dispatch({ type: "log", message: "Research failed" });
        }
      } finally {
        sub.unsubscribe();
        runners.delete(runId);
        flush();
      }
    },
    [agent, dispatch, flush, boardId, handleEvent],
  );

  /** Run one action on a node. Ignored while another action runs on the same node. */
  const runAction = useCallback(
    async (researchId: string, action: ActionRequest) => {
      const nodeId = action.target.id;
      if (activeRef.current.has(nodeId)) return;
      activeRef.current.add(nodeId);
      setActive((m) => new Map(m).set(nodeId, action.kind));
      setNotes((n) => {
        const next = { ...n };
        delete next[nodeId];
        return next;
      });

      const runner = agent.clone();
      runner.threadId = crypto.randomUUID();
      const runId = action.actionId;
      sessions.set(runId, { runId, researchId, boardId, kind: action.kind, status: "running", ops: [], applied: 0 });
      runners.set(runId, runner);
      setSession(runId, {});
      let failure: string | null = null;
      const sub = runner.subscribe({
        onCustomEvent: (arg: CustomEventArg) => {
          onGraphEvent(arg, runId);
          handleEvent(arg);
        },
        onRunErrorEvent: ({ event }: { event: { message: string } }) => void (failure = event.message),
      });
      try {
        await runner.runAgent({ forwardedProps: { question: action.target.label, researchId, action } satisfies ResearchRunProps });
      } catch (e) {
        failure ??= e instanceof Error ? e.message : String(e);
      } finally {
        sub.unsubscribe();
        flush();
        runners.delete(runId);
        if (sessions.get(runId)?.status === "cancelled") failure = null;
        else setSession(runId, { status: failure ? "failed" : "done" });
        activeRef.current.delete(nodeId);
        setActive((m) => {
          const next = new Map(m);
          next.delete(nodeId);
          return next;
        });
        if (failure) {
          setNotes((n) => ({ ...n, [nodeId]: { kind: action.kind, message: failure!, error: true } }));
          dispatch({ type: "log", message: `${ACTION_LABEL[action.kind]} failed: ${failure}` });
        }
      }
    },
    [agent, handleEvent, flush, dispatch, boardId],
  );

  /** Explicitly stop every running research job and action. */
  const cancel = useCallback(() => {
    for (const session of sessions.values()) {
      if (session.status !== "running" || session.boardId !== boardId) continue;
      setSession(session.runId, { status: "cancelled" });
      runners.get(session.runId)?.abortRun();
    }
    dispatch({ type: "log", message: "Research cancelled" });
  }, [dispatch, boardId]);

  /** Graph operations of every run still in progress, to restore them onto a cleared board. */
  const activeOps = useCallback(
    () => [...sessions.values()].filter((s) => s.status === "running" && s.boardId === boardId).flatMap((s) => s.ops),
    [boardId],
  );
  const anyActive = runningOn(boardId);

  return { research, running, anyActive, error, usage, active, notes, startResearch, runAction, cancel, activeOps };
}
