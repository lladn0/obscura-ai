"use client";

import {
  ExternalLink,
  Loader2,
  MessageSquarePlus,
  Microscope,
  ScanSearch,
  Swords,
  Telescope,
  type LucideIcon,
} from "lucide-react";

import type { ActionNote } from "@/agents/research/use-research-agent";
import type { NodeAction } from "@/agents/research/protocol";
import type { ResearchEdge, ResearchNode, SourceNode } from "@/graph/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ACTIONS: Record<NodeAction, { label: string; icon: LucideIcon; hint: string }> = {
  deepDive: { label: "Deep Dive", icon: Telescope, hint: "Research one more level under this node" },
  challenge: { label: "Challenge This", icon: Swords, hint: "Search for credible evidence against this claim" },
  findEvidence: { label: "Find Evidence", icon: ScanSearch, hint: "Look for new sources for or against this claim" },
  gaps: { label: "Research Gaps", icon: Microscope, hint: "Suggest unanswered questions in this branch" },
  followUp: { label: "Follow-Up", icon: MessageSquarePlus, hint: "Research a follow-up question under this one" },
};

/** Which actions make sense for a node. Sources and evidence are leaves of the trail. */
export function actionsFor(node: ResearchNode): NodeAction[] {
  switch (node.type) {
    case "question":
      return node.data.gap ? ["deepDive"] : ["deepDive", "gaps"];
    case "claim":
      return ["deepDive", "challenge", "findEvidence", "gaps"];
    case "insight":
      return ["challenge", "findEvidence", "deepDive"];
    default:
      return [];
  }
}

export function InvestigateActions({
  node,
  active,
  note,
  onRun,
}: {
  node: ResearchNode;
  active?: NodeAction;
  note?: ActionNote;
  onRun: (action: NodeAction) => void;
}) {
  const actions = actionsFor(node);
  if (!actions.length) return null;
  const blocked = !!active || !!node.data.generating;
  const isGap = node.type === "question" && !!node.data.gap;

  return (
    <div>
      <h3 className="mb-2 text-[11px] tracking-wide text-muted-foreground uppercase">Investigate</h3>
      <div className="grid grid-cols-2 gap-1.5">
        {actions.map((action) => {
          const { label, icon: Icon, hint } = ACTIONS[action];
          const running = active === action;
          return (
            <Button
              key={action}
              variant={isGap ? "secondary" : "outline"}
              size="sm"
              title={hint}
              disabled={blocked}
              onClick={() => onRun(action)}
              className={cn("justify-start", isGap && "col-span-2")}
            >
              {running ? <Loader2 className="animate-spin" /> : <Icon />}
              {isGap && action === "deepDive" ? "Research this gap" : label}
            </Button>
          );
        })}
      </div>
      {active && (
        <p className="mt-2 text-xs text-muted-foreground" role="status">
          {ACTIONS[active].label} in progress… the board stays usable.
        </p>
      )}
      {!active && note && (
        <p
          className={cn(
            "rh-fade-in mt-2 rounded-lg border px-2.5 py-2 text-xs leading-relaxed",
            note.error ? "border-rose-400/20 bg-rose-400/5 text-rose-200" : "border-white/[0.06] bg-white/[0.02] text-foreground/80",
          )}
        >
          {note.message}
        </p>
      )}
    </div>
  );
}

// --- Evidence trail ----------------------------------------------------------------

type TrailItem = { key: string; stance: "supports" | "disputes" | "cites"; excerpt?: string; source?: SourceNode };

/**
 * Sources behind a claim, traced through the existing graph: evidence nodes
 * (with their verified excerpt and stance) and directly cited sources. Nothing
 * is generated here; items without a captured excerpt say so.
 */
function evidenceTrail(node: ResearchNode, nodes: ResearchNode[], edges: ResearchEdge[]): TrailItem[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const sourceOf = (id: string) =>
    edges
      .filter((e) => e.source === id && e.data?.relation === "sourced_from")
      .map((e) => byId.get(e.target))
      .find((n): n is SourceNode => n?.type === "source");

  const items: TrailItem[] = [];
  const seen = new Set<string>();

  const evidenceEdges =
    node.type === "evidence"
      ? [{ source: node.id, relation: node.data.stance === "conflicting" ? "contradicts" : "supports" }]
      : edges
          .filter((e) => e.target === node.id && (e.data?.relation === "supports" || e.data?.relation === "contradicts"))
          .map((e) => ({ source: e.source, relation: e.data!.relation }));

  for (const e of evidenceEdges) {
    const ev = byId.get(e.source);
    if (ev?.type !== "evidence") continue;
    const source = sourceOf(ev.id);
    if (source) seen.add(source.id);
    items.push({
      key: ev.id,
      stance: e.relation === "contradicts" || ev.data.stance === "conflicting" ? "disputes" : "supports",
      excerpt: ev.data.quote,
      source,
    });
  }
  for (const e of edges) {
    if (e.source !== node.id || e.data?.relation !== "sourced_from" || seen.has(e.target)) continue;
    const source = byId.get(e.target);
    if (source?.type === "source") items.push({ key: source.id, stance: "cites", source });
  }
  return items;
}

const STANCE_STYLE = {
  supports: "text-emerald-300",
  disputes: "text-rose-300",
  cites: "text-muted-foreground",
} as const;

const STATUS_LABEL = { verified: "Supported", contested: "Disputed", unverified: "Unverified" } as const;

export function EvidenceTrail({
  node,
  nodes,
  edges,
  onSelect,
}: {
  node: ResearchNode;
  nodes: ResearchNode[];
  edges: ResearchEdge[];
  onSelect: (id: string) => void;
}) {
  if (node.type !== "claim" && node.type !== "insight" && node.type !== "evidence") return null;
  const items = evidenceTrail(node, nodes, edges);
  const status = node.type === "claim" ? (node.data.verification ?? (items.length ? undefined : "unverified")) : undefined;

  return (
    <div>
      <h3 className="mb-2 flex items-center gap-2 text-[11px] tracking-wide text-muted-foreground uppercase">
        Evidence trail
        {status && (
          <span
            className={cn(
              "rounded-full border px-1.5 py-px text-[10px] tracking-normal normal-case",
              status === "verified" && "border-emerald-400/30 text-emerald-300",
              status === "contested" && "border-rose-400/30 text-rose-300",
              status === "unverified" && "border-amber-400/30 text-amber-300",
            )}
          >
            {STATUS_LABEL[status]}
          </span>
        )}
      </h3>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">No sources are linked to this node yet. Try Find Evidence.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.key} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 text-xs">
              <span className={cn("text-[10px] font-medium tracking-wide uppercase", STANCE_STYLE[item.stance])}>
                {item.stance === "cites" ? "Cited source" : item.stance}
              </span>
              {item.excerpt ? (
                <blockquote className="mt-1 border-l-2 border-white/15 pl-2 leading-relaxed text-foreground/85 italic">
                  “{item.excerpt}”
                </blockquote>
              ) : (
                <p className="mt-1 text-muted-foreground">No excerpt captured for this source.</p>
              )}
              {item.source && (
                <div className="mt-1.5 flex min-w-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onSelect(item.source!.id)}
                    className="min-w-0 truncate text-left text-foreground/80 hover:text-foreground"
                    title={item.source.data.label}
                  >
                    {item.source.data.label}
                  </button>
                  {item.source.data.url && (
                    <a
                      href={item.source.data.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="ml-auto flex shrink-0 items-center gap-1 text-sky-300 hover:underline"
                      title={item.source.data.url}
                    >
                      {new URL(item.source.data.url).hostname.replace(/^www\./, "")}
                      <ExternalLink className="size-3" />
                    </a>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
