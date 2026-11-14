import type { EngagementEvent, ResearchSessionRecord } from "./engagement";

/**
 * Engagement statistics from tracked events. Every component score is a
 * simple, capped normalisation of real measurements (so excessive clicking
 * cannot inflate it), or null (N/A) when there is not enough data.
 */

export type ComponentKey = "navigation" | "revisiting" | "completion" | "exploration" | "notes";

export type ComponentScore = {
  key: ComponentKey;
  label: string;
  score: number | null;
  /** How the score is calculated, shown in the UI. */
  rule: string;
  /** Why it is N/A, when it is. */
  missing?: string;
};

export type Stats = {
  navigation: { switches: number; uniqueNodes: number; perBoard: { boardId: string; switches: number }[]; perDay: { day: string; count: number }[] };
  revisiting: { revisits: number; firstVisits: number; rate: number | null; top: { boardId: string; nodeId: string; count: number }[] };
  completion: { started: number; completed: number; durations: { boardId: string; ms: number; completedAt: number }[]; medianMs: number | null };
  exploration: { totalMs: number; nodesViewed: number; avgMsPerNode: number | null; top: { boardId: string; nodeId: string; ms: number }[] };
  notes: { created: number; attached: number; perBoard: { boardId: string; created: number; attached: number }[] };
  components: ComponentScore[];
  overall: number | null;
  hasActivity: boolean;
};

const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
const count = <K extends string>(items: K[]) => {
  const m = new Map<K, number>();
  for (const k of items) m.set(k, (m.get(k) ?? 0) + 1);
  return m;
};

/** Scoring rules (kept here so the page can show exactly what is computed). */
export const RULES = {
  navigation: "Unique nodes you deliberately opened × 5, capped at 100 (20 distinct nodes = 100). Repeated clicks on the same nodes don't add points.",
  revisiting: "Share of selections that return to an already visited node: 30% or more = 100, scaled linearly below. Needs at least 5 selections.",
  completion: "Research sessions you marked complete ÷ sessions started × 100. Duration is shown descriptively; faster is not scored as better.",
  exploration: "Nodes you actively viewed for at least 10 seconds in total × 10, capped at 100. Hidden tabs and unfocused windows don't count.",
  notes: "Notes you wrote × 20 plus notes attached to research nodes × 10, capped at 100. AI nodes never count.",
} as const;

export function computeStats(
  allEvents: EngagementEvent[],
  allSessions: ResearchSessionRecord[],
  boardId: string | null,
): Stats {
  const events = boardId ? allEvents.filter((e) => e.boardId === boardId) : allEvents;
  const sessions = boardId ? allSessions.filter((s) => s.boardId === boardId) : allSessions;
  const of = (type: EngagementEvent["type"]) => events.filter((e) => e.type === type);
  const key = (e: EngagementEvent) => `${e.boardId}|${e.nodeId}`;
  const split = (k: string) => {
    const [b, n] = k.split("|");
    return { boardId: b, nodeId: n };
  };

  // A. Navigation
  const selections = of("node_selected");
  const uniqueNodes = new Set(selections.map(key)).size;
  const perBoardNav = [...count(selections.map((e) => e.boardId))].map(([b, switches]) => ({ boardId: b, switches }));
  const days: { day: string; count: number }[] = [];
  const byDay = count(selections.map((e) => new Date(e.t).toISOString().slice(0, 10)));
  for (let i = 13; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    days.push({ day, count: byDay.get(day) ?? 0 });
  }

  // B. Revisiting
  const revisitEvents = of("node_revisited");
  const revisits = revisitEvents.length;
  const rate = selections.length ? revisits / selections.length : null;
  const topRevisited = [...count(revisitEvents.map(key))]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, c]) => ({ ...split(k), count: c }));

  // C. Completion (user-marked, not AI finishing)
  const completed = sessions.filter((s) => s.completedAt);
  const durations = completed
    .map((s) => ({ boardId: s.boardId, ms: s.activeMs, completedAt: s.completedAt! }))
    .sort((a, b) => a.completedAt - b.completedAt);
  const sorted = durations.map((d) => d.ms).sort((a, b) => a - b);
  const medianMs = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;

  // D. Node exploration
  const viewMs = new Map<string, number>();
  for (const e of of("node_viewed")) viewMs.set(key(e), (viewMs.get(key(e)) ?? 0) + (e.ms ?? 0));
  const totalMs = [...viewMs.values()].reduce((a, b) => a + b, 0);
  const topViewed = [...viewMs].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, ms]) => ({ ...split(k), ms }));
  const deepNodes = [...viewMs.values()].filter((ms) => ms >= 10_000).length;

  // E. Notes
  const created = of("note_created");
  const attached = new Set(of("note_attached").map(key));
  const notesPerBoard = [...new Set([...created.map((e) => e.boardId), ...[...attached].map((k) => split(k).boardId)])].map((b) => ({
    boardId: b,
    created: created.filter((e) => e.boardId === b).length,
    attached: [...attached].filter((k) => split(k).boardId === b).length,
  }));

  const hasActivity = events.length > 0 || sessions.length > 0;
  const components: ComponentScore[] = [
    {
      key: "navigation",
      label: "Navigation Activity",
      score: selections.length ? clamp(uniqueNodes * 5) : null,
      rule: RULES.navigation,
      missing: "No nodes opened yet.",
    },
    {
      key: "revisiting",
      label: "Information Revisiting",
      score: selections.length >= 5 && rate !== null ? clamp((rate / 0.3) * 100) : null,
      rule: RULES.revisiting,
      missing: "Needs at least 5 node selections.",
    },
    {
      key: "completion",
      label: "Challenge Completion",
      score: sessions.length ? clamp((completed.length / sessions.length) * 100) : null,
      rule: RULES.completion,
      missing: "No research sessions yet.",
    },
    {
      key: "exploration",
      label: "Node Exploration",
      score: viewMs.size ? clamp(deepNodes * 10) : null,
      rule: RULES.exploration,
      missing: "No active node viewing recorded yet.",
    },
    {
      key: "notes",
      label: "Personal Note-Taking",
      // Zero notes is a real measurement once the user has explored at all.
      score: hasActivity ? clamp(created.length * 20 + attached.size * 10) : null,
      rule: RULES.notes,
      missing: "No board activity yet.",
    },
  ];
  const valid = components.map((c) => c.score).filter((s): s is number => s !== null);

  return {
    navigation: { switches: selections.length, uniqueNodes, perBoard: perBoardNav, perDay: days },
    revisiting: { revisits, firstVisits: selections.length - revisits, rate, top: topRevisited },
    completion: { started: sessions.length, completed: completed.length, durations, medianMs },
    exploration: { totalMs, nodesViewed: viewMs.size, avgMsPerNode: viewMs.size ? totalMs / viewMs.size : null, top: topViewed },
    notes: { created: created.length, attached: attached.size, perBoard: notesPerBoard },
    components,
    overall: valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null,
    hasActivity,
  };
}
