"use client";

import { useState, type ReactNode, type RefObject } from "react";
import { ArrowUp, ChevronRight } from "lucide-react";

import type { ActivityEntry } from "@/graph/board-state";
import { EDGE_RELATIONS, NODE_KINDS, type QuestionNode, type ResearchNode } from "@/graph/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { KIND_STYLES, RELATION_STYLES } from "./styles";
import { usePersistentState } from "./use-persistent-state";

const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const ACTIVITY_PREVIEW = 5;

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

type QItem = { node: QuestionNode; children: QItem[] };

/** Question forest from stable parent references; cycles or missing parents fall back to roots. */
function questionForest(questions: QuestionNode[], parents: ReadonlyMap<string, string | undefined>): QItem[] {
  const kids = new Map<string, QuestionNode[]>();
  const roots: QuestionNode[] = [];
  for (const q of questions) {
    const p = parents.get(q.id);
    if (p) kids.set(p, [...(kids.get(p) ?? []), q]);
    else roots.push(q);
  }
  const seen = new Set<string>();
  const build = (q: QuestionNode): QItem => {
    seen.add(q.id);
    return { node: q, children: (kids.get(q.id) ?? []).filter((c) => !seen.has(c.id)).map(build) };
  };
  const forest = roots.map(build);
  // Anything unreachable (a parent cycle) is still listed.
  for (const q of questions) if (!seen.has(q.id)) forest.push(build(q));
  return forest;
}

/** VS Code-style explorer row: chevron folds the nested questions only (never the canvas). */
function QuestionRow({
  item,
  depth,
  selectedId,
  folded,
  onToggle,
  onSelect,
}: {
  item: QItem;
  depth: number;
  selectedId: string | null;
  folded: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const { node, children } = item;
  const open = !folded.has(node.id);
  const selected = node.id === selectedId;
  return (
    <li>
      <div
        className={cn(
          "group flex min-w-0 items-center rounded-md transition-colors hover:bg-white/[0.04]",
          selected && "bg-violet-400/[0.12] text-foreground hover:bg-violet-400/[0.15]",
        )}
      >
        {children.length ? (
          <button
            type="button"
            onClick={() => onToggle(node.id)}
            aria-label={open ? "Collapse questions" : "Expand questions"}
            aria-expanded={open}
            className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground md:size-5"
          >
            <ChevronRight className={cn("size-3.5 transition-transform duration-150", open && "rotate-90")} />
          </button>
        ) : (
          <span className="flex size-6 shrink-0 items-center justify-center md:size-5" aria-hidden>
            <span className={cn("size-1.5 rounded-full", node.data.gap ? "border border-violet-300/70" : "bg-violet-400/80")} />
          </span>
        )}
        <button
          type="button"
          onClick={() => onSelect(node.id)}
          title={node.data.label}
          aria-current={selected ? "true" : undefined}
          className={cn(
            "min-w-0 flex-1 truncate py-1.5 pr-2 text-left text-xs leading-snug md:py-1",
            depth === 0 ? "font-medium text-foreground/90" : "text-foreground/80",
            selected && "text-foreground",
          )}
        >
          {node.data.label || "Untitled question"}
        </button>
      </div>
      {children.length > 0 && open && (
        <ul className="ml-[11px] border-l border-white/[0.08] pl-1 md:ml-[9px]">
          {children.map((c) => (
            <QuestionRow
              key={c.node.id}
              item={c}
              depth={depth + 1}
              selectedId={selectedId}
              folded={folded}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function QuestionExplorer({
  questions,
  parents,
  selectedId,
  onSelect,
}: {
  questions: QuestionNode[];
  parents: ReadonlyMap<string, string | undefined>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  // Sidebar-only folding, independent of the canvas branch collapse.
  const [folded, setFolded] = usePersistentState<string[]>("rabbithole:question-explorer-folded", []);
  const foldedSet = new Set(folded);
  const forest = questionForest(questions, parents);
  if (!forest.length) return <p className="text-xs text-muted-foreground">No questions yet.</p>;
  return (
    <ul className="-mx-1 space-y-0.5" role="tree" aria-label="Questions">
      {forest.map((item) => (
        <QuestionRow
          key={item.node.id}
          item={item}
          depth={0}
          selectedId={selectedId}
          folded={foldedSet}
          onToggle={(id) => setFolded((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]))}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}

export function ResearchSidebar({
  nodes,
  questionParents,
  activity,
  selectedId,
  inputRef,
  busy,
  onAddQuestion,
  onSelect,
}: {
  nodes: ResearchNode[];
  /** Question id -> parent question id (undefined for roots). */
  questionParents: ReadonlyMap<string, string | undefined>;
  activity: ActivityEntry[];
  selectedId: string | null;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  busy: boolean;
  onAddQuestion: (question: string) => void;
  onSelect: (id: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const submit = () => {
    const q = draft.trim();
    if (!q || busy) return;
    onAddQuestion(q);
    setDraft("");
  };
  const questions = nodes.filter((n): n is QuestionNode => n.type === "question");

  return (
    // Fixed input on top, one scroll region below: the page itself never scrolls.
    <div className="flex h-full min-h-0 w-72 max-w-full flex-col overflow-hidden">
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
            <Button
              size="icon-sm"
              aria-label="Start research"
              title={busy ? "Research in progress…" : "Start research (Enter)"}
              onClick={submit}
              disabled={!draft.trim() || busy}
            >
              <ArrowUp />
            </Button>
          </div>
        </div>
      </div>

      <div className="rh-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto border-t border-white/[0.06]">
        <Section id="questions" title="Questions" count={questions.length}>
          <QuestionExplorer
            questions={questions}
            parents={questionParents}
            selectedId={selectedId}
            onSelect={onSelect}
          />
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
