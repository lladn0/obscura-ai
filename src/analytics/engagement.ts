"use client";

/**
 * Local, privacy-light engagement tracking. Events carry ids and timestamps
 * only (never research text), live in localStorage, and are written in
 * batches (every few seconds and when the tab is hidden), not on every change.
 * Only deliberate user actions are recorded; AI-driven graph changes never are.
 */

export type EngagementEventType =
  | "board_opened"
  | "node_selected"
  | "node_revisited"
  | "node_viewed"
  | "note_created"
  | "note_attached"
  | "research_session_started"
  | "research_session_completed";

export type EngagementEvent = {
  t: number;
  type: EngagementEventType;
  boardId: string;
  nodeId?: string;
  /** Duration (node_viewed: active viewing time; session completed: active session time). */
  ms?: number;
  sessionId?: string;
};

/** A research challenge: from opening a board to the user marking it complete. */
export type ResearchSessionRecord = {
  id: string;
  boardId: string;
  startedAt: number;
  /** Time the board was open with the tab visible and focused. */
  activeMs: number;
  completedAt?: number;
};

const EVENTS_KEY = "rabbithole:analytics:events:v1";
const SESSIONS_KEY = "rabbithole:analytics:sessions:v1";
const MAX_EVENTS = 5000;
/** Shorter looks are not meaningful viewing; longer stints are capped (likely idle). */
const MIN_VIEW_MS = 1000;
const MAX_VIEW_MS = 5 * 60_000;
const FLUSH_MS = 5000;

const isBrowser = typeof window !== "undefined";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

let events: EngagementEvent[] | null = null;
let sessions: Record<string, ResearchSessionRecord> | null = null;
let dirty = false;
let timer: ReturnType<typeof setTimeout> | null = null;

const allEvents = () => (events ??= read<EngagementEvent[]>(EVENTS_KEY, []));
const allSessions = () => (sessions ??= read<Record<string, ResearchSessionRecord>>(SESSIONS_KEY, {}));

export function flush() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!dirty) return;
  accrueBoardTime();
  try {
    localStorage.setItem(EVENTS_KEY, JSON.stringify(allEvents().slice(-MAX_EVENTS)));
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(allSessions()));
    dirty = false;
  } catch {
    // Storage full or unavailable: keep the data in memory.
  }
}

const schedule = () => {
  dirty = true;
  timer ??= setTimeout(flush, FLUSH_MS);
};

function track(type: EngagementEventType, boardId: string, extra: Partial<EngagementEvent> = {}) {
  allEvents().push({ t: Date.now(), type, boardId, ...extra });
  schedule();
}

export const getEvents = () => {
  accrueBoardTime();
  stopView(false);
  return allEvents();
};
export const getSessions = () => {
  accrueBoardTime();
  return Object.values(allSessions());
};

// --- Activity: is the user actually looking? ---------------------------------

const pageActive = () => isBrowser && document.visibilityState === "visible" && document.hasFocus();

let current: { boardId: string; nodeId: string; since: number | null; ms: number } | null = null;
let board: { boardId: string; since: number | null } | null = null;

function pause() {
  if (current?.since) {
    current.ms += Date.now() - current.since;
    current.since = null;
  }
  accrueBoardTime();
  if (board) board.since = null;
  flush();
}

function resume() {
  if (!pageActive()) return;
  if (current && !current.since) current.since = Date.now();
  if (board && !board.since) board.since = Date.now();
}

if (isBrowser) {
  document.addEventListener("visibilitychange", () => (document.visibilityState === "hidden" ? pause() : resume()));
  window.addEventListener("blur", pause);
  window.addEventListener("focus", resume);
  window.addEventListener("pagehide", () => {
    stopView(false);
    pause();
  });
}

// --- Nodes -------------------------------------------------------------------

const visited = new Map<string, Set<string>>();
const visitedOn = (boardId: string) => {
  let set = visited.get(boardId);
  if (!set) {
    set = new Set(allEvents().filter((e) => e.boardId === boardId && e.type === "node_selected").map((e) => e.nodeId!));
    visited.set(boardId, set);
  }
  return set;
};
let lastSelected: { boardId: string; nodeId: string } | null = null;

/** A deliberate selection (click, sidebar, connection list). Re-selecting the same node is not a switch. */
export function nodeSelected(boardId: string, nodeId: string) {
  if (lastSelected?.boardId === boardId && lastSelected.nodeId === nodeId) return;
  lastSelected = { boardId, nodeId };
  const seen = visitedOn(boardId);
  track("node_selected", boardId, { nodeId });
  if (seen.has(nodeId)) track("node_revisited", boardId, { nodeId });
  seen.add(nodeId);
}

function stopView(keep = true) {
  if (!current) return;
  const ms = Math.min(MAX_VIEW_MS, current.ms + (current.since ? Date.now() - current.since : 0));
  if (ms >= MIN_VIEW_MS) track("node_viewed", current.boardId, { nodeId: current.nodeId, ms: Math.round(ms) });
  if (keep && current.since) {
    current.ms = 0;
    current.since = Date.now();
  } else current = null;
}

/** The node whose details are on screen (null: none). Timers pause while the page is inactive. */
export function viewNode(boardId: string, nodeId: string | null) {
  if (current?.boardId === boardId && current.nodeId === nodeId) return;
  stopView(false);
  if (!nodeId) lastSelected = null;
  else current = { boardId, nodeId, since: pageActive() ? Date.now() : null, ms: 0 };
}

// --- Notes -------------------------------------------------------------------

export const noteCreated = (boardId: string, nodeId: string) => track("note_created", boardId, { nodeId });
export const noteAttached = (boardId: string, nodeId: string) => track("note_attached", boardId, { nodeId });

// --- Research sessions ("challenges") ------------------------------------------

function accrueBoardTime() {
  if (!board?.since) return;
  const s = openSession(board.boardId);
  if (s) s.activeMs += Date.now() - board.since;
  board.since = pageActive() ? Date.now() : null;
  dirty = true;
}

export const openSession = (boardId: string) =>
  Object.values(allSessions())
    .filter((s) => s.boardId === boardId && !s.completedAt)
    .sort((a, b) => b.startedAt - a.startedAt)[0] ?? null;

export const lastSession = (boardId: string) =>
  Object.values(allSessions())
    .filter((s) => s.boardId === boardId)
    .sort((a, b) => b.startedAt - a.startedAt)[0] ?? null;

/** The user starts (or continues) exploring a board: a session begins unless one is open. */
export function boardOpened(boardId: string) {
  const last = allEvents().findLast((e) => e.type === "board_opened");
  // Re-mounts (dev double effects, fast back/forward) are the same visit.
  if (!(last?.boardId === boardId && Date.now() - last.t < 2000)) track("board_opened", boardId);
  if (!openSession(boardId)) {
    const id = `s-${crypto.randomUUID().slice(0, 8)}`;
    allSessions()[id] = { id, boardId, startedAt: Date.now(), activeMs: 0 };
    track("research_session_started", boardId, { sessionId: id });
  }
  board = { boardId, since: pageActive() ? Date.now() : null };
}

export function boardClosed(boardId: string) {
  if (board?.boardId !== boardId) return;
  if (current?.boardId === boardId) viewNode(boardId, null);
  accrueBoardTime();
  board = null;
  flush();
}

/** "Mark Research Complete": the user, not the AI, decides the challenge is done. */
export function completeSession(boardId: string): ResearchSessionRecord | null {
  accrueBoardTime();
  const s = openSession(boardId);
  if (!s) return null;
  s.completedAt = Date.now();
  track("research_session_completed", boardId, { sessionId: s.id, ms: Math.round(s.activeMs) });
  flush();
  return s;
}
