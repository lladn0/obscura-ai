"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BrainCircuit,
  Check,
  CircleHelp,
  Compass,
  GitBranch,
  Layers,
  Loader2,
  Network,
  PenLine,
  Pickaxe,
  Spline,
  StickyNote,
  X,
} from "lucide-react";

import {
  ACTIVITY_METRICS,
  bucketize,
  computeInsights,
  groundedItems,
  metricTimes,
  quizAttempts,
  recentContributions,
  saveQuizAttempt,
  suggestionsFor,
  type ActivityMetric,
  type BoardInsight,
  type QuizAttempt,
  type QuizQuestion,
  type Suggestion,
} from "@/analytics/insights";
import { quizCompleted } from "@/analytics/engagement";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const boardHref = (boardId: string, nodeId?: string) =>
  `/boards/${boardId}${nodeId ? `?focus=${encodeURIComponent(nodeId)}` : ""}`;

const DATE = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
function ago(t: number) {
  if (!t) return "—";
  const d = Math.floor((Date.now() - t) / 86_400_000);
  if (d <= 0) return "Today";
  if (d === 1) return "Yesterday";
  if (d < 7) return `${d} days ago`;
  return DATE.format(t);
}
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <section className={cn("rounded-2xl border border-white/[0.07] bg-card/60 p-5", className)}>{children}</section>;
}

function SectionTitle({ icon: Icon, title, hint }: { icon: typeof Compass; title: string; hint?: string }) {
  return (
    <div className="mb-4 flex items-baseline gap-2">
      <Icon className="size-4 translate-y-0.5 text-violet-300" />
      <h2 className="font-medium">{title}</h2>
      {hint && <span className="ml-auto text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub }: { icon: typeof Compass; label: string; value: number | string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-card/60 p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="flex size-7 items-center justify-center rounded-lg bg-violet-500/15 text-violet-200">
          <Icon className="size-3.5" />
        </span>
        {label}
      </div>
      <div className="mt-3 text-2xl font-semibold tabular-nums sm:text-3xl">{value}</div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Coverage({ value }: { value: number | null }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
      <div
        className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-[width] duration-700"
        style={{ width: `${Math.round((value ?? 0) * 100)}%` }}
      />
    </div>
  );
}

function Chip({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "violet" }) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-[11px]",
        tone === "violet" ? "border-violet-400/25 text-violet-200" : "border-white/10 text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

// --- Research progress per board ---------------------------------------------------

function BoardProgress({ b, detailed }: { b: BoardInsight; detailed?: boolean }) {
  const open = b.openQuestions.length;
  const branches = b.unexploredBranches.length;
  return (
    <Card className={cn("flex flex-col", detailed && "sm:p-6")}>
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/10 text-violet-200">
          <Network className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <Link href={boardHref(b.meta.id)} className="line-clamp-2 font-medium leading-snug hover:text-violet-200" title={b.meta.title}>
            {b.meta.title}
          </Link>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Last activity {ago(b.lastActivity).toLowerCase()}</p>
        </div>
        <span className="text-xl font-semibold tabular-nums">{pct(b.coverage)}</span>
      </div>

      <div className="mt-4 space-y-1.5">
        <Coverage value={b.coverage} />
        <p className="text-xs text-muted-foreground">
          {b.researchNodes ? (
            <>
              Explored <span className="text-foreground/90 tabular-nums">{b.explored}</span> /{" "}
              <span className="tabular-nums">{b.researchNodes}</span> research nodes
            </>
          ) : (
            "No research on this board yet"
          )}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {open > 0 && <Chip tone="violet">{plural(open, "open question")}</Chip>}
        {branches > 0 && <Chip tone="violet">{`${branches} unexplored branch${branches === 1 ? "" : "es"}`}</Chip>}
        <Chip>{plural(b.notes, "note")}</Chip>
        <Chip>{plural(b.deepDives, "Deep Dive")}</Chip>
      </div>

      <Link
        href={boardHref(b.meta.id)}
        className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "mt-4 w-full rounded-xl sm:w-auto sm:self-start")}
      >
        Continue Exploring <ArrowRight />
      </Link>
    </Card>
  );
}

// --- Unexplored knowledge ------------------------------------------------------------

const SUGGESTION_KIND: Record<Suggestion["kind"], string> = {
  gap: "Research gap",
  question: "Unanswered question",
  branch: "Unexplored branch",
  claim: "Not investigated yet",
};

function Unexplored({ items, showBoard }: { items: Suggestion[]; showBoard: boolean }) {
  return (
    <Card>
      <SectionTitle icon={Compass} title="Unexplored Knowledge" />
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing obvious left: you&apos;ve opened every branch and question so far.</p>
      ) : (
        <ul className="divide-y divide-white/[0.05]">
          {items.map((s) => (
            <li key={`${s.boardId}/${s.nodeId}`} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground/90" title={s.label}>
                  {s.label || "Untitled"}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {SUGGESTION_KIND[s.kind]}
                  {showBoard && ` · ${s.boardTitle}`}
                </p>
              </div>
              <Link
                href={boardHref(s.boardId, s.nodeId)}
                className={cn(buttonVariants({ variant: "outline", size: "xs" }), "shrink-0 rounded-lg")}
              >
                Explore
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// --- Activity chart -------------------------------------------------------------------

const RANGES = [
  { key: 7, label: "7 days" },
  { key: 30, label: "30 days" },
  { key: "all", label: "All time" },
] as const;

function ActivityChart({ events }: { events: Parameters<typeof metricTimes>[0] }) {
  const [metric, setMetric] = useState<ActivityMetric>("topics");
  const [range, setRange] = useState<7 | 30 | "all">(30);
  const [hover, setHover] = useState<number | null>(null);
  const buckets = useMemo(() => bucketize(metricTimes(events, metric), range), [events, metric, range]);
  const total = buckets.reduce((s, b) => s + b.count, 0);
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const label = ACTIVITY_METRICS.find((m) => m.key === metric)!.label;
  const fmt = (b: (typeof buckets)[number]) =>
    b.step === 1 ? DATE.format(b.start) : `Week of ${DATE.format(b.start)}`;

  return (
    <Card>
      <SectionTitle icon={Layers} title="Research Activity" />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-xl bg-white/[0.03] p-1">
          {ACTIVITY_METRICS.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setMetric(m.key)}
              aria-pressed={metric === m.key}
              className={cn(
                "rounded-lg px-2.5 py-1 text-xs transition-colors",
                metric === m.key ? "bg-violet-500/20 text-violet-100" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
        <select
          value={String(range)}
          onChange={(e) => setRange(e.target.value === "all" ? "all" : (Number(e.target.value) as 7 | 30))}
          aria-label="Time range"
          className="ml-auto h-8 rounded-lg border border-white/10 bg-background/60 px-2 text-xs outline-none focus:border-violet-400/40"
        >
          {RANGES.map((r) => (
            <option key={r.key} value={String(r.key)}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-baseline justify-between">
        <p className="text-sm">
          <span className="text-2xl font-semibold tabular-nums">{total}</span>{" "}
          <span className="text-muted-foreground">{label.toLowerCase()}</span>
        </p>
        <p className="h-4 text-xs text-muted-foreground tabular-nums">
          {hover !== null && `${fmt(buckets[hover])}: ${buckets[hover].count}`}
        </p>
      </div>

      {total === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-xs text-muted-foreground">
          No {label.toLowerCase()} recorded in this period.
        </p>
      ) : (
        <>
          <div className="mt-3 flex h-32 items-end gap-[2px]" onMouseLeave={() => setHover(null)} role="img" aria-label={`${label} per ${buckets[0].step === 1 ? "day" : "week"}`}>
            {buckets.map((b, i) => (
              <div
                key={b.start}
                className="flex h-full min-w-0 flex-1 cursor-default flex-col justify-end"
                onMouseEnter={() => setHover(i)}
                onClick={() => setHover(i)}
                title={`${fmt(b)}: ${b.count}`}
              >
                <div
                  className={cn(
                    "rounded-t-[4px] transition-colors",
                    b.count ? (hover === i ? "bg-fuchsia-400" : "bg-violet-500/80") : "bg-white/[0.05]",
                  )}
                  style={{ height: b.count ? `${Math.max(4, (b.count / max) * 100)}%` : "2px" }}
                />
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground tabular-nums">
            <span>{DATE.format(buckets[0].start)}</span>
            <span>Today</span>
          </div>
        </>
      )}
    </Card>
  );
}

// --- Contributions --------------------------------------------------------------------

function Contributions({ boards, events, showBoard }: { boards: BoardInsight[]; events: Parameters<typeof recentContributions>[1]; showBoard: boolean }) {
  const sum = (f: (b: BoardInsight) => number) => boards.reduce((s, b) => s + f(b), 0);
  const counts = [
    { icon: StickyNote, label: "Notes", value: sum((b) => b.notes) },
    { icon: CircleHelp, label: "Follow-up questions", value: sum((b) => b.followUps) },
    { icon: Spline, label: "Manual connections", value: sum((b) => b.connections) },
    { icon: PenLine, label: "Edited research nodes", value: sum((b) => b.edited) },
  ];
  const recent = recentContributions(boards, events);
  return (
    <Card>
      <SectionTitle icon={PenLine} title="Your Contributions" hint="Created by you, not the AI" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {counts.map(({ icon: Icon, label, value }) => (
          <div key={label} className="rounded-xl bg-white/[0.03] p-3">
            <Icon className="size-3.5 text-violet-300" />
            <div className="mt-2 text-lg font-semibold tabular-nums">{value}</div>
            <div className="text-[11px] text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>
      {recent.length > 0 && (
        <ul className="mt-4 divide-y divide-white/[0.05]">
          {recent.map((c, i) => (
            <li key={i} className="flex items-center gap-3 py-2 text-sm">
              <Link href={boardHref(c.boardId, c.nodeId)} className="min-w-0 flex-1 truncate text-foreground/85 hover:text-violet-200" title={c.text}>
                {c.text}
              </Link>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {showBoard && <span className="mr-2 hidden max-w-40 truncate align-bottom sm:inline-block">{c.boardTitle}</span>}
                {ago(c.t)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// --- Knowledge check (one board) --------------------------------------------------------

const newAttempt = (boardId: string, questions: QuizQuestion[], answers: number[]): QuizAttempt => ({
  id: crypto.randomUUID().slice(0, 8),
  boardId,
  at: Date.now(),
  questions,
  answers,
});

function KnowledgeCheck({ b }: { b: BoardInsight }) {
  const items = useMemo(() => groundedItems(b), [b]);
  const [attempts, setAttempts] = useState<QuizAttempt[]>(() => quizAttempts(b.meta.id));
  const [quiz, setQuiz] = useState<QuizQuestion[] | null>(null);
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = !!quiz && answers.every((a) => a !== null);
  const last = attempts[attempts.length - 1];

  const start = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: b.meta.title, items }),
      });
      const data = (await res.json()) as { questions?: QuizQuestion[]; error?: string };
      if (!res.ok || !data.questions) throw new Error(data.error || "Couldn't create a knowledge check.");
      setQuiz(data.questions);
      setAnswers(data.questions.map(() => null));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const answer = (qi: number, oi: number) => {
    if (!quiz || answers[qi] !== null) return;
    const next = answers.map((a, i) => (i === qi ? oi : a));
    setAnswers(next);
    if (next.every((a) => a !== null)) {
      const attempt = newAttempt(b.meta.id, quiz, next as number[]);
      saveQuizAttempt(attempt);
      setAttempts((a) => [...a, attempt]);
      quizCompleted(b.meta.id, quiz.filter((q, i) => q.answer === next[i]).length, quiz.length);
    }
  };

  const score = (a: QuizAttempt) => a.questions.filter((q, i) => q.answer === a.answers[i]).length;

  return (
    <Card>
      <SectionTitle
        icon={BrainCircuit}
        title="Test My Understanding"
        hint={last ? `Last check: ${score(last)}/${last.questions.length} · ${ago(last.at)}` : undefined}
      />
      {!quiz ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <p className="flex-1 text-sm text-muted-foreground">
            {items.length >= 3
              ? `A short multiple-choice check built from ${items.length} source-backed findings on this board. Separate from exploration coverage.`
              : "Not enough source-backed findings on this board yet. Research further or run Find Evidence, then try again."}
          </p>
          <Button onClick={start} disabled={items.length < 3 || loading} className="rounded-xl">
            {loading ? <Loader2 className="animate-spin" /> : <BrainCircuit />}
            {loading ? "Preparing…" : "Test My Understanding"}
          </Button>
        </div>
      ) : (
        <div className="space-y-5">
          {quiz.map((q, qi) => {
            const picked = answers[qi];
            return (
              <div key={qi}>
                <p className="text-sm font-medium">
                  {qi + 1}. {q.question}
                </p>
                <div className="mt-2 grid gap-1.5">
                  {q.options.map((o, oi) => {
                    const isAnswer = oi === q.answer;
                    const show = picked !== null;
                    return (
                      <button
                        key={oi}
                        type="button"
                        disabled={show}
                        onClick={() => answer(qi, oi)}
                        className={cn(
                          "flex items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                          !show && "border-white/10 hover:border-violet-400/40 hover:bg-violet-500/5",
                          show && isAnswer && "border-emerald-400/40 bg-emerald-400/10",
                          show && !isAnswer && picked === oi && "border-rose-400/40 bg-rose-400/10",
                          show && !isAnswer && picked !== oi && "border-white/[0.06] text-muted-foreground",
                        )}
                      >
                        {show && isAnswer && <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-300" />}
                        {show && !isAnswer && picked === oi && <X className="mt-0.5 size-3.5 shrink-0 text-rose-300" />}
                        <span>{o}</span>
                      </button>
                    );
                  })}
                </div>
                {picked !== null && (
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    <span className={picked === q.answer ? "text-emerald-300" : "text-rose-300"}>
                      {picked === q.answer ? "Correct. " : "Not quite. "}
                    </span>
                    {q.explanation}{" "}
                    <Link href={boardHref(b.meta.id, q.nodeId)} className="text-violet-300 hover:underline">
                      Review this topic
                    </Link>
                  </p>
                )}
              </div>
            );
          })}
          {done && (
            <div className="flex flex-wrap items-center gap-3 border-t border-white/[0.06] pt-4">
              <p className="text-sm">
                Result:{" "}
                <span className="font-semibold tabular-nums">
                  {quiz.filter((q, i) => q.answer === answers[i]).length} / {quiz.length}
                </span>{" "}
                correct
              </p>
              <Button variant="outline" size="sm" className="ml-auto rounded-xl" onClick={() => setQuiz(null)}>
                Done
              </Button>
            </div>
          )}
        </div>
      )}
      {error && <p className="mt-3 text-xs text-rose-300">{error}</p>}
    </Card>
  );
}

// --- Page -------------------------------------------------------------------------------

export default function StatisticsView() {
  const [{ boards, events }] = useState(computeInsights);
  const [boardId, setBoardId] = useState<string>("all");
  const board = boards.find((b) => b.meta.id === boardId) ?? null;
  const scope = board ? [board] : boards;
  const scopedEvents = board ? events.filter((e) => e.boardId === board.meta.id) : events;
  const sum = (f: (b: BoardInsight) => number) => scope.reduce((s, b) => s + f(b), 0);
  const suggestions = suggestionsFor(scope);
  const byActivity = [...boards].sort((a, b) => b.lastActivity - a.lastActivity);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Research Insights</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Understand what you&apos;ve explored, discover what you&apos;re missing, and decide where to go next.
          </p>
        </div>
        <select
          value={boardId}
          onChange={(e) => setBoardId(e.target.value)}
          aria-label="Board"
          className="h-10 w-full rounded-lg border border-white/10 bg-background/60 px-3 text-sm outline-none focus:border-violet-400/40 sm:w-auto sm:max-w-xs"
        >
          <option value="all">All boards</option>
          {boards.map((b) => (
            <option key={b.meta.id} value={b.meta.id}>
              {b.meta.title}
            </option>
          ))}
        </select>
      </div>

      {boards.length === 0 ? (
        <Card className="mt-8 flex flex-col items-center px-6 py-14 text-center">
          <Network className="size-6 text-violet-300" />
          <h2 className="mt-3 font-medium">No research yet</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">Create a board and start exploring to see your insights here.</p>
          <Link href="/boards" className={cn(buttonVariants(), "mt-5 rounded-xl")}>
            Go to Boards
          </Link>
        </Card>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 md:mt-8 lg:grid-cols-4">
            {board ? (
              <StatCard icon={Network} label="Research Nodes" value={board.researchNodes} sub="Questions, claims, insights" />
            ) : (
              <StatCard icon={Network} label="Research Boards" value={boards.length} />
            )}
            <StatCard
              icon={Compass}
              label="Concepts Explored"
              value={sum((b) => b.explored)}
              sub={`of ${sum((b) => b.researchNodes)} research nodes`}
            />
            <StatCard icon={Pickaxe} label="Deep Dives" value={sum((b) => b.deepDives)} />
            <StatCard
              icon={PenLine}
              label="Personal Contributions"
              value={sum((b) => b.notes + b.userQuestions)}
              sub={`${sum((b) => b.notes)} notes · ${sum((b) => b.userQuestions)} questions`}
            />
          </div>

          {board ? (
            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              <BoardProgress b={board} detailed />
              <Unexplored items={suggestions} showBoard={false} />
              <div className="lg:col-span-2">
                <KnowledgeCheck key={board.meta.id} b={board} />
              </div>
              <ActivityChart events={scopedEvents} />
              <Contributions boards={scope} events={scopedEvents} showBoard={false} />
            </div>
          ) : (
            <>
              <div className="mt-8">
                <SectionTitle icon={GitBranch} title="Research Progress" hint="Coverage of existing research, not a learning score" />
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {byActivity.map((b) => (
                    <BoardProgress key={b.meta.id} b={b} />
                  ))}
                </div>
              </div>
              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                <Unexplored items={suggestions} showBoard />
                <ActivityChart events={scopedEvents} />
                <div className="lg:col-span-2">
                  <Contributions boards={scope} events={scopedEvents} showBoard />
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
