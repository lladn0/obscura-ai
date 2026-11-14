"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BarChart3, Compass, Info, NotebookPen, Repeat, Timer, Trophy } from "lucide-react";

import { getEvents, getSessions } from "@/analytics/engagement";
import { computeStats, type ComponentKey, type ComponentScore } from "@/analytics/stats";
import { listBoards, loadBoardById } from "@/graph/board-store";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ICONS: Record<ComponentKey, typeof Compass> = {
  navigation: Compass,
  revisiting: Repeat,
  completion: Trophy,
  exploration: Timer,
  notes: NotebookPen,
};

const duration = (ms: number) => {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
};

/** Big score ring (0..100). */
function ScoreRing({ value }: { value: number | null }) {
  const r = 54;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative size-40 shrink-0">
      <svg viewBox="0 0 128 128" className="size-full -rotate-90">
        <circle cx="64" cy="64" r={r} fill="none" stroke="rgb(255 255 255 / 0.07)" strokeWidth="10" />
        {value !== null && (
          <circle
            cx="64"
            cy="64"
            r={r}
            fill="none"
            stroke="url(#rh-score)"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - value / 100)}
            className="transition-[stroke-dashoffset] duration-700"
          />
        )}
        <defs>
          <linearGradient id="rh-score" x1="0" x2="1">
            <stop offset="0" stopColor="#8b5cf6" />
            <stop offset="1" stopColor="#d946ef" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-semibold tabular-nums">{value ?? "N/A"}</span>
        {value !== null && <span className="text-xs text-muted-foreground">/ 100</span>}
      </div>
    </div>
  );
}

/** Minimal horizontal bar list. */
function Bars({ items, format }: { items: { label: string; value: number }[]; format: (v: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <p className="text-xs text-muted-foreground">Nothing recorded yet.</p>;
  return (
    <ul className="space-y-1.5">
      {items.map((i, idx) => (
        <li key={idx} className="text-xs">
          <div className="flex justify-between gap-2">
            <span className="truncate text-foreground/80" title={i.label}>
              {i.label}
            </span>
            <span className="shrink-0 text-muted-foreground tabular-nums">{format(i.value)}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500"
              style={{ width: `${(i.value / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Vertical bars over time (last 14 days). */
function Columns({ items }: { items: { day: string; count: number }[] }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div className="flex h-24 items-end gap-1">
      {items.map((d) => (
        <div key={d.day} className="flex h-full flex-1 flex-col justify-end" title={`${d.day}: ${d.count} switches`}>
          <div
            className={cn("rounded-t-sm", d.count ? "bg-gradient-to-t from-violet-500/70 to-fuchsia-400" : "bg-white/[0.06]")}
            style={{ height: d.count ? `${Math.max(6, (d.count / max) * 100)}%` : "3px" }}
          />
        </div>
      ))}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function ComponentCard({ c, children }: { c: ComponentScore; children: React.ReactNode }) {
  const Icon = ICONS[c.key];
  return (
    <section className="flex flex-col rounded-2xl border border-white/[0.07] bg-card/60 p-5">
      <header className="flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-lg bg-violet-500/15 text-violet-200">
          <Icon className="size-4" />
        </span>
        <h3 className="text-sm font-medium">{c.label}</h3>
        <span className="ml-auto text-lg font-semibold tabular-nums">
          {c.score ?? <span className="text-sm font-normal text-muted-foreground">N/A</span>}
          {c.score !== null && <span className="text-xs font-normal text-muted-foreground"> /100</span>}
        </span>
      </header>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500" style={{ width: `${c.score ?? 0}%` }} />
      </div>
      <div className="mt-4 flex-1 space-y-4">{children}</div>
      <p className="mt-4 border-t border-white/[0.06] pt-3 text-[11px] leading-relaxed text-muted-foreground">
        {c.score === null && c.missing ? <span className="text-foreground/70">{c.missing} </span> : null}
        {c.rule}
      </p>
    </section>
  );
}

export default function StatisticsView() {
  const boards = useMemo(() => listBoards(), []);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [data] = useState(() => ({ events: getEvents(), sessions: getSessions() }));
  const stats = useMemo(() => computeStats(data.events, data.sessions, boardId), [data, boardId]);

  // Node labels are read from the boards themselves; analytics store ids only.
  const labels = useMemo(
    () => new Map(boards.map((b) => [b.id, new Map((loadBoardById(b.id)?.nodes ?? []).map((x) => [x.id, x.data.label]))])),
    [boards],
  );
  const label = (b: string, n: string) => labels.get(b)?.get(n) || "Deleted node";
  const boardTitle = (id: string) => boards.find((b) => b.id === id)?.title ?? "Deleted board";
  const comp = (k: ComponentKey) => stats.components.find((c) => c.key === k)!;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Statistics</h1>
          <p className="mt-1 text-sm text-muted-foreground">How you explore and engage with your research.</p>
        </div>
        <select
          value={boardId ?? ""}
          onChange={(e) => setBoardId(e.target.value || null)}
          aria-label="Filter by board"
          className="h-10 w-full max-w-full rounded-lg border sm:w-auto sm:max-w-xs border-white/10 bg-card px-3 text-sm outline-none focus:border-white/25"
        >
          <option value="">All boards</option>
          {boards.map((b) => (
            <option key={b.id} value={b.id}>
              {b.title}
            </option>
          ))}
        </select>
      </div>

      {!stats.hasActivity ? (
        <div className="mt-16 flex flex-col items-center rounded-2xl border border-dashed border-white/10 px-6 py-16 text-center">
          <BarChart3 className="size-8 text-violet-300" />
          <h2 className="mt-4 font-medium">No activity yet</h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Statistics appear once you open a board and start exploring: selecting nodes, reading them, writing notes and
            marking research complete. Nothing is estimated or made up.
          </p>
          <Link href="/boards" className={buttonVariants({ className: "mt-6 rounded-xl" })}>
            Go to Boards
          </Link>
        </div>
      ) : (
        <>
          {/* Overall score */}
          <section className="relative mt-6 overflow-hidden rounded-3xl border border-white/[0.08] bg-card/60 p-5 sm:mt-8 sm:p-8">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_50%_80%_at_0%_50%,rgb(139_92_246/0.18),transparent_70%)]"
            />
            <div className="relative flex flex-col items-center gap-8 sm:flex-row">
              <ScoreRing value={stats.overall} />
              <div className="min-w-0 flex-1 text-center sm:text-left">
                <h2 className="text-xl font-semibold tracking-tight">Cognitive Engagement Score</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  The average of the components below that have enough data (
                  {stats.components.filter((c) => c.score !== null).length} of 5).
                </p>
                <div className="mt-5 grid grid-cols-2 gap-2 text-left sm:grid-cols-5 sm:gap-3">
                  {stats.components.map((c) => (
                    <div key={c.key} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                      <div className="text-[11px] text-muted-foreground">{c.label}</div>
                      <div className="text-base font-semibold tabular-nums">{c.score ?? "N/A"}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <p className="relative mt-6 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              An engagement indicator based on your own activity on this device. It is not a scientifically validated
              measure of intelligence, comprehension or learning.
            </p>
          </section>

          {/* Components */}
          <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <ComponentCard c={comp("navigation")}>
              <div className="grid grid-cols-3 gap-2">
                <Metric label="Node switches" value={stats.navigation.switches} />
                <Metric label="Unique nodes" value={stats.navigation.uniqueNodes} />
                <Metric label="Boards" value={stats.navigation.perBoard.length} />
              </div>
              <div>
                <p className="mb-2 text-[11px] text-muted-foreground">Switches, last 14 days</p>
                <Columns items={stats.navigation.perDay} />
              </div>
            </ComponentCard>

            <ComponentCard c={comp("revisiting")}>
              <div className="grid grid-cols-3 gap-2">
                <Metric label="Revisits" value={stats.revisiting.revisits} />
                <Metric label="First visits" value={stats.revisiting.firstVisits} />
                <Metric
                  label="Revisit rate"
                  value={stats.revisiting.rate === null ? "N/A" : `${Math.round(stats.revisiting.rate * 100)}%`}
                />
              </div>
              <div>
                <p className="mb-2 text-[11px] text-muted-foreground">Most revisited nodes</p>
                <Bars
                  items={stats.revisiting.top.map((t) => ({ label: label(t.boardId, t.nodeId), value: t.count }))}
                  format={(v) => `${v}×`}
                />
              </div>
            </ComponentCard>

            <ComponentCard c={comp("completion")}>
              <div className="grid grid-cols-3 gap-2">
                <Metric label="Sessions" value={stats.completion.started} />
                <Metric label="Completed" value={stats.completion.completed} />
                <Metric label="Median time" value={stats.completion.medianMs === null ? "N/A" : duration(stats.completion.medianMs)} />
              </div>
              <div>
                <p className="mb-2 text-[11px] text-muted-foreground">Active time of completed sessions</p>
                <Bars
                  items={stats.completion.durations.slice(-6).map((d) => ({
                    label: `${boardTitle(d.boardId)} · ${new Date(d.completedAt).toLocaleDateString()}`,
                    value: d.ms,
                  }))}
                  format={duration}
                />
              </div>
            </ComponentCard>

            <ComponentCard c={comp("exploration")}>
              <div className="grid grid-cols-3 gap-2">
                <Metric label="Active viewing" value={duration(stats.exploration.totalMs)} />
                <Metric label="Nodes viewed" value={stats.exploration.nodesViewed} />
                <Metric
                  label="Avg per node"
                  value={stats.exploration.avgMsPerNode === null ? "N/A" : duration(stats.exploration.avgMsPerNode)}
                />
              </div>
              <div>
                <p className="mb-2 text-[11px] text-muted-foreground">Most explored nodes</p>
                <Bars items={stats.exploration.top.map((t) => ({ label: label(t.boardId, t.nodeId), value: t.ms }))} format={duration} />
              </div>
            </ComponentCard>

            <ComponentCard c={comp("notes")}>
              <div className="grid grid-cols-3 gap-2">
                <Metric label="Notes created" value={stats.notes.created} />
                <Metric label="Attached" value={stats.notes.attached} />
                <Metric label="Boards with notes" value={stats.notes.perBoard.filter((b) => b.created).length} />
              </div>
              <div>
                <p className="mb-2 text-[11px] text-muted-foreground">Notes per board</p>
                <Bars
                  items={stats.notes.perBoard.map((b) => ({ label: boardTitle(b.boardId), value: b.created }))}
                  format={(v) => String(v)}
                />
              </div>
            </ComponentCard>

            <section className="rounded-2xl border border-white/[0.07] bg-white/[0.015] p-5 text-xs leading-relaxed text-muted-foreground">
              <h3 className="mb-2 text-sm font-medium text-foreground">How this is measured</h3>
              <ul className="list-disc space-y-1.5 pl-4">
                <li>Only your deliberate actions count: clicking nodes, opening them from lists, writing and linking notes.</li>
                <li>Nodes created or updated by the AI never count as your activity.</li>
                <li>Viewing time pauses when the tab is hidden, the window loses focus, or you switch nodes.</li>
                <li>A research session starts when you open a board and ends when you mark it complete.</li>
                <li>Everything stays in this browser; nothing is sent anywhere.</li>
              </ul>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
