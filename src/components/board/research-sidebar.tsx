"use client";

import { useState } from "react";
import { ArrowUp, History } from "lucide-react";

import type { ActivityEntry } from "@/graph/board-state";
import { EDGE_RELATIONS, NODE_KINDS, type ResearchNode } from "@/graph/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { KIND_STYLES, RELATION_STYLES } from "./styles";

const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2.5 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
      {children}
    </h2>
  );
}

export function ResearchSidebar({
  nodes,
  activity,
  onAddQuestion,
}: {
  nodes: ResearchNode[];
  activity: ActivityEntry[];
  onAddQuestion: (question: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const submit = () => {
    const q = draft.trim();
    if (!q) return;
    onAddQuestion(q);
    setDraft("");
  };

  return (
    <aside className="flex w-72 shrink-0 flex-col gap-6 overflow-y-auto border-r border-white/[0.06] bg-sidebar/60 p-4">
      <section>
        <SectionTitle>Research</SectionTitle>
        <div className="rounded-xl border border-white/10 bg-background/60 p-2 focus-within:border-violet-400/40">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Ask a research question…"
            className="min-h-16 resize-none border-0 bg-transparent p-1 shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <div className="flex items-center justify-between pt-1">
            <span className="pl-1 text-[11px] text-muted-foreground">Agents not connected yet</span>
            <Button size="icon-sm" aria-label="Add question" onClick={submit} disabled={!draft.trim()}>
              <ArrowUp />
            </Button>
          </div>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground/80">
          For now, a new question is added to the board as a Question node.
        </p>
      </section>

      <section>
        <SectionTitle>On this board</SectionTitle>
        <ul className="space-y-1.5">
          {NODE_KINDS.map((kind) => {
            const style = KIND_STYLES[kind];
            const count = nodes.filter((n) => n.type === kind).length;
            return (
              <li key={kind} className="flex items-center gap-2 text-sm">
                <span className={cn("size-2 rounded-full", style.dot)} />
                <span className="text-foreground/90">{style.label}</span>
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">{count}</span>
              </li>
            );
          })}
        </ul>
        <ul className="mt-4 space-y-1.5">
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
      </section>

      <section className="min-h-0">
        <SectionTitle>Activity</SectionTitle>
        {activity.length === 0 ? (
          <p className="text-xs text-muted-foreground">No activity yet.</p>
        ) : (
          <ol className="relative space-y-3 border-l border-white/10 pl-3.5">
            {activity.map((entry) => (
              <li key={entry.id} className="rh-fade-in relative">
                <span className="absolute top-1.5 -left-[18px] size-1.5 rounded-full bg-white/30" />
                <p className="text-xs leading-relaxed text-foreground/85">{entry.message}</p>
                <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                  <History className="size-2.5" />
                  {time.format(new Date(entry.at))}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </aside>
  );
}
