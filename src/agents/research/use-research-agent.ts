"use client";

import { useCallback, useEffect, useReducer, useRef, useState, type Dispatch } from "react";
import type { AbstractAgent } from "@ag-ui/client";
import type { AgentSubscriber } from "@ag-ui/client";
import { useAgent } from "@copilotkit/react-core/v2";

import type { BoardAction, StreamOp } from "@/graph/board-state";
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
  kind: "research" | NodeAction;
  status: "running" | "done" | "failed" | "cancelled";
  /** Every graph operation the run produced, so its results can be restored. */
  ops: StreamOp[];
};
const sessions = new Map<string, ResearchSession>();
const sessionListeners = new Set<() => void>();
const setSession = (runId: string, patch: Partial<ResearchSession>) => {
  const cur = sessions.get(runId);
  if (cur) Object.assign(cur, patch);
  for (const l of sessionListeners) l();
};
/** The main research run currently receiving the shared agent's events. */
const mainRun = { current: null as string | null };
const researchRunning = () => [...sessions.values()].some((s) => s.kind === "research" && s.status === "running");

type CustomEventArg = Parameters<NonNullable<AgentSubscriber["onCustomEvent"]>>[0];

/**
 * Connects the board to the research agent over AG-UI (via CopilotKit).
 * Graph events are queued and flushed once per animation frame, so text
 * chunks from parallel branches and concurrent actions become one update.
 * Node actions run on their own agent clone (own thread), so several can
 * stream at once next to the main research.
 */
export function useResearchAgent(dispatch: Dispatch<BoardAction>) {
  // Re-renders are driven by our own state below, not by every agent event.
  const { agent } = useAgent({ agentId: RESEARCH_AGENT_ID, updates: [] });
  const [research, setResearch] = useState<ResearchState | null>(null);
  // Derived from the session store, so a remounted workspace still knows a run is active.
  const [, refresh] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    sessionListeners.add(refresh);
    return () => void sessionListeners.delete(refresh);
  }, []);
  const running = researchRunning();
  const runners = useRef(new Map<string, AbstractAgent>());
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageTotals>(NO_USAGE);
  const [active, setActive] = useState<ReadonlyMap<string, NodeAction>>(new Map());
  const [notes, setNotes] = useState<Readonly<Record<string, ActionNote>>>({});

  const queue = useRef<StreamOp[]>([]);
  const frame = useRef<number | null>(null);
  const lastSeq = useRef(new Map<string, number>());
  const branchStatus = useRef(new Map<string, string>());
  const activeRef = useRef(new Set<string>());

  const flush = useCallback(() => {
    frame.current = null;
    const ops = queue.current;
    queue.current = [];
    if (ops.length) dispatch({ type: "stream", ops });
  }, [dispatch]);

  const enqueue = useCallback(
    (op: StreamOp, runId: string | null) => {
      if (runId) sessions.get(runId)?.ops.push(op);
      queue.current.push(op);
      frame.current ??= requestAnimationFrame(flush);
    },
    [flush],
  );

  /** Graph and usage events, shared by the main research run and every action run. */
  const handleEvent = useCallback(
    ({ event }: CustomEventArg, runId: string | null) => {
      const enqueueOp = (op: StreamOp) => enqueue(op, runId);
      switch (event.name) {
        case GraphEvent.NodeCreated: {
          const v = event.value as NodeCreated;
          enqueueOp({ op: "node", nodeId: v.nodeId, kind: v.kind, researchId: v.researchId, branchId: v.branchId, data: v.data, collapsed: v.collapsed });
          break;
        }
        case GraphEvent.NodeText: {
          const v = event.value as NodeText;
          // Per-node ordering: drop duplicates and anything older than what we applied.
          if (v.seq <= (lastSeq.current.get(v.nodeId) ?? 0)) break;
          lastSeq.current.set(v.nodeId, v.seq);
          enqueueOp({ op: "text", nodeId: v.nodeId, field: v.field, delta: v.delta });
          break;
        }
        case GraphEvent.NodeCompleted: {
          const v = event.value as NodeCompleted;
          enqueueOp({ op: "done", nodeId: v.nodeId, data: v.data });
          break;
        }
        case GraphEvent.NodeRemoved:
          enqueueOp({ op: "remove", nodeId: (event.value as { nodeId: string }).nodeId });
          break;
        case GraphEvent.EdgeCreated: {
          const v = event.value as EdgeCreated;
          enqueueOp({ op: "edge", edgeId: v.edgeId, source: v.source, target: v.target, relation: v.relation });
          break;
        }
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
    [enqueue, dispatch],
  );

  useEffect(() => {
    const { unsubscribe } = agent.subscribe({
      onCustomEvent: (arg) => handleEvent(arg, mainRun.current),
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
  }, [agent, handleEvent, dispatch]);

  const startResearch = useCallback(
    async (props: ResearchRunProps) => {
      setError(null);
      setUsage(NO_USAGE);
      const runId = `run-${crypto.randomUUID().slice(0, 8)}`;
      sessions.set(runId, { runId, researchId: props.researchId, kind: "research", status: "running", ops: [] });
      mainRun.current = runId;
      setSession(runId, {});
      branchStatus.current.clear();
      dispatch({ type: "log", message: `Research started: “${props.question}”` });
      try {
        await agent.runAgent({ forwardedProps: props });
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
        flush();
      }
    },
    [agent, dispatch, flush],
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
      sessions.set(runId, { runId, researchId, kind: action.kind, status: "running", ops: [] });
      runners.current.set(runId, runner);
      setSession(runId, {});
      let failure: string | null = null;
      const sub = runner.subscribe({
        onCustomEvent: (arg: CustomEventArg) => handleEvent(arg, runId),
        onRunErrorEvent: ({ event }: { event: { message: string } }) => void (failure = event.message),
      });
      try {
        await runner.runAgent({ forwardedProps: { question: action.target.label, researchId, action } satisfies ResearchRunProps });
      } catch (e) {
        failure ??= e instanceof Error ? e.message : String(e);
      } finally {
        sub.unsubscribe();
        flush();
        runners.current.delete(runId);
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
    [agent, handleEvent, flush, dispatch],
  );

  /** Explicitly stop every running research job and action. */
  const cancel = useCallback(() => {
    for (const session of sessions.values()) {
      if (session.status !== "running") continue;
      setSession(session.runId, { status: "cancelled" });
      if (session.kind === "research") agent.abortRun();
      else runners.current.get(session.runId)?.abortRun();
    }
    dispatch({ type: "log", message: "Research cancelled" });
  }, [agent, dispatch]);

  /** Graph operations of every run still in progress, to restore them onto a cleared board. */
  const activeOps = useCallback(
    () => [...sessions.values()].filter((s) => s.status === "running").flatMap((s) => s.ops),
    [],
  );
  const anyActive = [...sessions.values()].some((s) => s.status === "running");

  useEffect(() => () => void (frame.current && cancelAnimationFrame(frame.current)), []);

  return { research, running, anyActive, error, usage, active, notes, startResearch, runAction, cancel, activeOps };
}
