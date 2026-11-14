"use client";

/**
 * Research Insights: derived only from saved boards and the local event log.
 * Coverage = research nodes the user opened / research nodes that exist now
 * (it changes as research adds nodes). It is not a learning or quality score.
 */
import { getEvents, getSessions, type EngagementEvent } from "./engagement";
import { listBoards, loadBoardById, type BoardMeta } from "@/graph/board-store";
import { ancestors, buildHierarchy, descendants } from "@/graph/hierarchy";
import type { ResearchEdge, ResearchNode } from "@/graph/types";

export type SuggestionKind = "gap" | "question" | "branch" | "claim";
export type Suggestion = {
  boardId: string;
  boardTitle: string;
  nodeId: string;
  label: string;
  kind: SuggestionKind;
};

export type BoardInsight = {
  meta: BoardMeta;
  nodes: ResearchNode[];
  edges: ResearchEdge[];
  /** Questions, claims and insights (sources, evidence excerpts and notes excluded). */
  researchNodes: number;
  explored: number;
  /** 0..1, null when the board has no research yet. */
  coverage: number | null;
  notes: number;
  /** Research questions the user typed plus their follow-ups. */
  userQuestions: number;
  followUps: number;
  connections: number;
  edited: number;
  deepDives: number;
  openQuestions: Suggestion[];
  unexploredBranches: Suggestion[];
  uninvestigatedClaims: Suggestion[];
  lastActivity: number;
};

const RESEARCH_KINDS = new Set(["question", "claim", "insight"]);
const isRootQuestion = (id: string) => id.endsWith(":root");
const isFollowUp = (id: string) => id.startsWith("fq-");

function boardInsight(meta: BoardMeta, events: EngagementEvent[]): BoardInsight | null {
  const state = loadBoardById(meta.id);
  if (!state) return null;
  const nodes = state.nodes.filter((n) => !n.data.demo);
  const edges = state.edges;
  const mine = events.filter((e) => e.boardId === meta.id);
  const research = nodes.filter((n) => RESEARCH_KINDS.has(n.type));
  const researchIds = new Set(research.map((n) => n.id));
  const selected = new Set(mine.filter((e) => e.type === "node_selected").map((e) => e.nodeId!));
  const explored = research.filter((n) => selected.has(n.id)).length;
  const deepDived = new Set(mine.filter((e) => e.type === "deep_dive_completed").map((e) => e.nodeId!));

  const h = buildHierarchy(nodes, edges);
  const kids = (id: string) => (h.children.get(id) ?? []).filter((c) => researchIds.has(c));
  const s = (n: ResearchNode, kind: SuggestionKind): Suggestion => ({
    boardId: meta.id,
    boardTitle: meta.title,
    nodeId: n.id,
    label: n.data.label,
    kind,
  });

  // Questions the research left open (gaps) and user follow-ups with nothing under them yet.
  const openQuestions = research
    .filter((n) => n.type === "question" && !isRootQuestion(n.id) && !n.data.generating)
    .filter((n) => (n.type === "question" && n.data.gap) || isFollowUp(n.id))
    .filter((n) => kids(n.id).length === 0)
    .map((n) => s(n, n.type === "question" && n.data.gap ? "gap" : "question"));

  // Research directions where the user has not opened the direction or anything below it.
  const unexploredBranches = research
    .filter((n) => n.id.endsWith(":direction"))
    .filter((n) => ![n.id, ...descendants(h, n.id)].some((id) => selected.has(id)))
    .map((n) => s(n, "branch"));

  // Important findings the user has not opened or deep-dived (inside branches they already explore).
  const branchExplored = (id: string) => ancestors(h, id).some((a) => selected.has(a));
  const uninvestigatedClaims = research
    .filter((n) => n.type === "claim" && !n.id.endsWith(":direction") && !n.data.challenge)
    .filter((n) => !selected.has(n.id) && !deepDived.has(n.id) && branchExplored(n.id))
    .sort((a, b) => (b.data.importance ?? 0.5) - (a.data.importance ?? 0.5))
    .map((n) => s(n, "claim"));

  const lastEvent = mine.reduce((m, e) => Math.max(m, e.t), 0);
  return {
    meta,
    nodes,
    edges,
    researchNodes: research.length,
    explored,
    coverage: research.length ? explored / research.length : null,
    notes: nodes.filter((n) => n.type === "note").length,
    userQuestions: nodes.filter((n) => n.type === "question" && (isRootQuestion(n.id) || isFollowUp(n.id))).length,
    followUps: nodes.filter((n) => isFollowUp(n.id)).length,
    connections: edges.filter((e) => e.data?.manual).length,
    edited: nodes.filter((n) => n.type !== "note" && n.data.userEdited).length,
    deepDives: mine.filter((e) => e.type === "deep_dive_completed").length,
    openQuestions,
    unexploredBranches,
    uninvestigatedClaims,
    lastActivity: Math.max(lastEvent, Date.parse(meta.updatedAt) || 0),
  };
}

export type Insights = { boards: BoardInsight[]; events: EngagementEvent[] };

export function computeInsights(): Insights {
  const events = getEvents();
  getSessions(); // flushes the open session's active time
  const boards = listBoards()
    .map((b) => boardInsight(b, events))
    .filter((b): b is BoardInsight => !!b);
  const ids = new Set(boards.map((b) => b.meta.id));
  return { boards, events: events.filter((e) => ids.has(e.boardId)) };
}

/** A few suggestions, mixed across kinds and boards (most recently active boards first). */
export function suggestionsFor(boards: BoardInsight[], limit = 6): Suggestion[] {
  const sorted = [...boards].sort((a, b) => b.lastActivity - a.lastActivity);
  const pools = [
    sorted.flatMap((b) => b.openQuestions),
    sorted.flatMap((b) => b.unexploredBranches),
    sorted.flatMap((b) => b.uninvestigatedClaims),
  ];
  const out: Suggestion[] = [];
  for (let i = 0; out.length < limit && pools.some((p) => i < p.length); i++)
    for (const p of pools) if (p[i] && out.length < limit) out.push(p[i]);
  return out;
}

// --- Activity over time -------------------------------------------------------

export type ActivityMetric = "sessions" | "topics" | "deepDives" | "notes";
export const ACTIVITY_METRICS: { key: ActivityMetric; label: string }[] = [
  { key: "sessions", label: "Research sessions" },
  { key: "topics", label: "Topics explored" },
  { key: "deepDives", label: "Deep Dives" },
  { key: "notes", label: "Notes created" },
];

/** Event timestamps for one metric. "Topics explored" counts each node's first opening only. */
export function metricTimes(events: EngagementEvent[], metric: ActivityMetric): number[] {
  switch (metric) {
    case "sessions":
      return events.filter((e) => e.type === "research_session_started").map((e) => e.t);
    case "deepDives":
      return events.filter((e) => e.type === "deep_dive_completed").map((e) => e.t);
    case "notes":
      return events.filter((e) => e.type === "note_created").map((e) => e.t);
    case "topics": {
      const seen = new Set<string>();
      const out: number[] = [];
      for (const e of events) {
        if (e.type !== "node_selected") continue;
        const k = `${e.boardId}/${e.nodeId}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(e.t);
      }
      return out;
    }
  }
}

const DAY = 86_400_000;
const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Daily buckets (weekly when "all time" spans more than ~3 months). */
export function bucketize(times: number[], range: 7 | 30 | "all", now = Date.now()) {
  const today = startOfDay(now);
  const first = times.length ? startOfDay(Math.min(...times)) : today;
  const days = range === "all" ? Math.max(7, Math.round((today - first) / DAY) + 1) : range;
  const step = days > 90 ? 7 : 1;
  const count = Math.ceil(days / step);
  const start = today - (count * step - 1) * DAY;
  const buckets = Array.from({ length: count }, (_, i) => ({ start: start + i * step * DAY, step, count: 0 }));
  for (const t of times) {
    const i = Math.floor((startOfDay(t) - start) / (step * DAY));
    if (i >= 0 && i < count) buckets[i].count++;
  }
  return buckets;
}

// --- Contributions ----------------------------------------------------------------

export type Contribution = { t: number; boardId: string; boardTitle: string; nodeId?: string; text: string };

const CONTRIBUTION_TEXT: Partial<Record<EngagementEvent["type"], string>> = {
  note_created: "Note",
  question_asked: "Research question",
  follow_up_created: "Follow-up question",
  connection_created: "Connection",
  node_edited: "Edited",
};

/** Recent user contributions that still exist on their boards. */
export function recentContributions(boards: BoardInsight[], events: EngagementEvent[], limit = 6): Contribution[] {
  const byBoard = new Map(boards.map((b) => [b.meta.id, b]));
  const out: Contribution[] = [];
  for (let i = events.length - 1; i >= 0 && out.length < limit; i--) {
    const e = events[i];
    const kind = CONTRIBUTION_TEXT[e.type];
    const b = byBoard.get(e.boardId);
    if (!kind || !b || !e.nodeId) continue;
    const label = (id: string) => b.nodes.find((n) => n.id === id)?.data.label;
    if (e.type === "connection_created") {
      const edge = b.edges.find((x) => x.id === e.nodeId);
      if (!edge) continue;
      out.push({
        t: e.t,
        boardId: b.meta.id,
        boardTitle: b.meta.title,
        nodeId: edge.source,
        text: `${kind}: ${label(edge.source) || "Note"} → ${label(edge.target) || "Note"}`,
      });
      continue;
    }
    const text = label(e.nodeId);
    if (text === undefined) continue;
    out.push({ t: e.t, boardId: b.meta.id, boardTitle: b.meta.title, nodeId: e.nodeId, text: `${kind}: ${text || "Untitled"}` });
  }
  return out;
}

// --- Knowledge check material -------------------------------------------------------

export type QuizItem = { nodeId: string; statement: string; quote?: string; source?: string };

/**
 * Findings that are grounded in sources: the critic marked them verified, or an
 * evidence excerpt supports them. Unsupported or contested claims are never used.
 */
export function groundedItems(b: BoardInsight, limit = 14): QuizItem[] {
  const byId = new Map(b.nodes.map((n) => [n.id, n]));
  const items: QuizItem[] = [];
  for (const n of b.nodes) {
    if (n.type !== "claim" && n.type !== "insight") continue;
    if (n.type === "claim" && (n.data.verification === "contested" || n.data.verification === "unverified" || n.data.challenge))
      continue;
    const support = b.edges
      .filter((e) => e.target === n.id && e.data?.relation === "supports")
      .map((e) => byId.get(e.source))
      .find((ev) => ev?.type === "evidence" && ev.data.quote);
    const verified = n.type === "claim" && n.data.verification === "verified";
    if (!support && !verified) continue;
    const sourceEdge = b.edges.find(
      (e) => e.source === (support?.id ?? n.id) && e.data?.relation === "sourced_from",
    );
    const source = sourceEdge ? byId.get(sourceEdge.target)?.data.label : undefined;
    items.push({
      nodeId: n.id,
      statement: [n.data.label, n.data.description].filter(Boolean).join(" — ").slice(0, 600),
      quote: support?.type === "evidence" ? support.data.quote?.slice(0, 400) : undefined,
      source,
    });
  }
  return items.sort((a, b2) => (byId.get(b2.nodeId)?.data.importance ?? 0.5) - (byId.get(a.nodeId)?.data.importance ?? 0.5)).slice(0, limit);
}

export type QuizQuestion = { nodeId: string; question: string; options: string[]; answer: number; explanation: string };
export type QuizAttempt = { id: string; boardId: string; at: number; questions: QuizQuestion[]; answers: number[] };

const QUIZ_KEY = "rabbithole:quiz-attempts:v1";
export function quizAttempts(boardId: string): QuizAttempt[] {
  try {
    return (JSON.parse(localStorage.getItem(QUIZ_KEY) ?? "[]") as QuizAttempt[]).filter((a) => a.boardId === boardId);
  } catch {
    return [];
  }
}
export function saveQuizAttempt(a: QuizAttempt) {
  try {
    const all = JSON.parse(localStorage.getItem(QUIZ_KEY) ?? "[]") as QuizAttempt[];
    localStorage.setItem(QUIZ_KEY, JSON.stringify([...all, a].slice(-100)));
  } catch {
    // Storage unavailable: the result is still shown.
  }
}
