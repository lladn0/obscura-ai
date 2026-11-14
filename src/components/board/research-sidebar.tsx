"use client";

import { useState, type ReactNode, type RefObject } from "react";
import { ArrowUp, ChevronRight } from "lucide-react";

import type { ActivityEntry } from "@/graph/board-state";
import { EDGE_RELATIONS, NODE_KINDS, type ResearchNode } from "@/graph/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { KIND_STYLES, RELATION_STYLES } from "./styles";
import { usePersistentState } from "./use-persistent-state";

const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const ACTIVITY_PREVIEW = 5;
const QUESTIONS_PREVIEW = 6;

function Section({
  id,
  title,
  count,
  defaultOpen = true,
  children,
}: {
  id: string;
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = usePersistentState(`rabbithole:section:${id}`, defaultOpen);
  return (
    <section className="border-t border-white/[0.06] first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-4 py-2.5 text-left text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase transition-colors hover:text-foreground"
      >
        <ChevronRight className={cn("size-3 transition-transform duration-200", open && "rotate-90")} />
        {title}
        {count !== undefined && (
          <span className="ml-auto font-normal tracking-normal tabular-nums">{count}</span>
        )}
      </button>
      {open && <div className="rh-fade-in px-4 pb-4">{children}</div>}
    </section>
  );
}

function Legend({ nodes }: { nodes: ResearchNode[] }) {
  return (
    <>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {NODE_KINDS.map((kind) => {
          const style = KIND_STYLES[kind];
          return (
            <li key={kind} className="flex min-w-0 items-center gap-2 text-xs">
              <span className={cn("size-2 shrink-0 rounded-full", style.dot)} />
              <span className="truncate text-foreground/85">{style.label}</span>
              <span className="ml-auto text-muted-foreground tabular-nums">
                {nodes.filter((n) => n.type === kind).length}
              </span>
            </li>
          );
        })}
      </ul>
      <ul className="mt-3 space-y-1.5">
        {EDGE_RELATIONS.map((relation) => {
          const style = RELATION_STYLES[relation];
          return (
            <li key={relation} className="flex items-center gap-2 text-xs text-muted-foreground">
              <svg width="28" height="8" className="shrink-0" aria-hidden>
                <line
                  x1="1"
                  y1="4"
                  x2={style.directed ? 22 : 27}
                  y2="4"
                  stroke={style.color}
                  strokeWidth={style.width}
                  strokeDasharray={style.dash}
                  strokeLinecap="round"
                />
                {style.directed && <path d="M 21 0.5 L 28 4 L 21 7.5 z" fill={style.color} />}
              </svg>
              {style.label}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Activity({ activity }: { activity: ActivityEntry[] }) {
  const [showAll, setShowAll] = useState(false);
  if (activity.length === 0) return <p className="text-xs text-muted-foreground">No activity yet.</p>;
  const shown = showAll ? activity : activity.slice(0, ACTIVITY_PREVIEW);
  return (
    <>
      <ol className="relative space-y-2.5 border-l border-white/10 pl-3.5">
        {shown.map((entry) => (
          <li key={entry.id} className="relative min-w-0">
            <span className="absolute top-1.5 -left-[18px] size-1.5 rounded-full bg-white/25" />
            <p className="text-xs leading-relaxed break-words text-foreground/85">{entry.message}</p>
            <p className="text-[10px] text-muted-foreground">{time.format(new Date(entry.at))}</p>
          </li>
        ))}
      </ol>
      {activity.length > ACTIVITY_PREVIEW && (
        <button
          type="button"
          onClick={() => setShowAll(!showAll)}
          className="mt-2.5 text-xs text-muted-foreground hover:text-foreground"
        >
          {showAll ? "Show less" : `Show ${activity.length - ACTIVITY_PREVIEW} older`}
        </button>
      )}
    </>
  );
}

export function ResearchSidebar({
  nodes,
  activity,
  selectedId,
  inputRef,
  onAddQuestion,
  onSelect,
}: {
  nodes: ResearchNode[];
  activity: ActivityEntry[];
  selectedId: string | null;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onAddQuestion: (question: string) => void;
  onSelect: (id: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [allQuestions, setAllQuestions] = useState(false);
  const submit = () => {
    const q = draft.trim();
    if (!q) return;
    onAddQuestion(q);
    setDraft("");
  };
  const questions = nodes.filter((n) => n.type === "question");

  return (
    // Fixed input on top, one scroll region below: the page itself never scrolls.
    <div className="flex h-full min-h-0 w-72 flex-col overflow-hidden">
      <div className="shrink-0 p-3">
        <div className="rounded-xl border border-white/10 bg-background/60 p-1.5 transition-colors focus-within:border-violet-400/40">
          <Textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Ask a research question…"
            aria-label="Research question"
            className="max-h-40 min-h-14 resize-none border-0 bg-transparent p-1.5 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <div className="flex items-center justify-end">
            <Button size="icon-sm" aria-label="Add question" onClick={submit} disabled={!draft.trim()}>
              <ArrowUp />
            </Button>
          </div>
        </div>
      </div>

      <div className="rh-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto border-t border-white/[0.06]">
        <Section id="questions" title="Questions" count={questions.length}>
          <ul className="space-y-0.5">
            {(allQuestions ? questions : questions.slice(0, QUESTIONS_PREVIEW)).map((q) => (
              <li key={q.id}>
                <button
                  type="button"
                  onClick={() => onSelect(q.id)}
                  className={cn(
                    "flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs leading-snug text-foreground/85 transition-colors hover:bg-white/[0.04]",
                    q.id === selectedId && "bg-white/[0.06] text-foreground",
                  )}
                >
                  <span className="mt-1 size-1.5 shrink-0 rounded-full bg-violet-400" />
                  <span className="line-clamp-2 break-words">{q.data.label}</span>
                </button>
              </li>
            ))}
          </ul>
          {questions.length > QUESTIONS_PREVIEW && (
            <button
              type="button"
              onClick={() => setAllQuestions(!allQuestions)}
              className="mt-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              {allQuestions ? "Show less" : `Show ${questions.length - QUESTIONS_PREVIEW} more`}
            </button>
          )}
        </Section>
        <Section id="activity" title="Activity" count={activity.length}>
          <Activity activity={activity} />
        </Section>
        <Section id="legend" title="Legend" defaultOpen={false}>
          <Legend nodes={nodes} />
        </Section>
      </div>
    </div>
  );
}
