"use client";

import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  FoldVertical,
  UnfoldVertical,
  Crosshair,
  PanelRightClose,
  PinOff,
  X,
} from "lucide-react";

import type { ResearchEdge, ResearchNode } from "@/graph/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ConfidenceBar } from "./nodes";
import { KIND_STYLES, RELATION_STYLES } from "./styles";

const CONNECTIONS_PREVIEW = 4;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="text-sm break-words text-foreground/90">{children}</dd>
    </div>
  );
}

function KindFields({ node }: { node: ResearchNode }) {
  switch (node.type) {
    case "question":
      return node.data.status ? <Field label="Status"><span className="capitalize">{node.data.status}</span></Field> : null;
    case "claim":
    case "insight":
      return (
        <>
          {node.data.confidence !== undefined && (
            <Field label="Confidence">
              <ConfidenceBar
                value={node.data.confidence}
                className={node.type === "claim" ? "bg-sky-400/80" : "bg-emerald-400/80"}
              />
            </Field>
          )}
          {node.type === "claim" && node.data.contested && (
            <Field label="Status"><span className="text-rose-300">Contested</span></Field>
          )}
        </>
      );
    case "evidence":
      return (
        <>
          {node.data.stance && <Field label="Stance"><span className="capitalize">{node.data.stance}</span></Field>}
          {node.data.quote && (
            <Field label="Quote">
              <blockquote className="border-l-2 border-amber-400/40 pl-2.5 text-muted-foreground italic">
                {node.data.quote}
              </blockquote>
            </Field>
          )}
        </>
      );
    case "source":
      return (
        <>
          {node.data.sourceType && <Field label="Type"><span className="capitalize">{node.data.sourceType}</span></Field>}
          {(node.data.publisher || node.data.year) && (
            <Field label="Published">{[node.data.publisher, node.data.year].filter(Boolean).join(" · ")}</Field>
          )}
          <Field label="Link">
            {node.data.url ? (
              <a href={node.data.url} target="_blank" rel="noreferrer" className="break-all text-sky-300 hover:underline">
                {node.data.url}
              </a>
            ) : (
              <span className="text-muted-foreground">No URL attached</span>
            )}
          </Field>
        </>
      );
  }
}

export type BranchInfo = { children: number; collapsed: boolean; hidden: number };

export function NodeDetails({
  node,
  nodes,
  edges,
  branch,
  pinned,
  onSelect,
  onCenter,
  onToggleBranch,
  onUnpin,
  onCollapsePanel,
  onClose,
}: {
  node: ResearchNode;
  nodes: ResearchNode[];
  edges: ResearchEdge[];
  branch: BranchInfo;
  pinned: boolean;
  onSelect: (id: string) => void;
  onCenter: () => void;
  onToggleBranch: () => void;
  onUnpin: () => void;
  onCollapsePanel: () => void;
  onClose: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const style = KIND_STYLES[node.type];
  const Icon = style.icon;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const connections = edges
    .filter((e) => e.source === node.id || e.target === node.id)
    .map((e) => {
      const outgoing = e.source === node.id;
      return { edge: e, outgoing, other: byId.get(outgoing ? e.target : e.source) };
    })
    .filter((c) => c.other);
  const shown = showAll ? connections : connections.slice(0, CONNECTIONS_PREVIEW);

  return (
    <div className="flex h-full min-h-0 w-80 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-3 py-2">
        <span className={cn("flex size-6 items-center justify-center rounded-md", style.chip)}>
          <Icon className="size-3.5" />
        </span>
        <span className={cn("text-[11px] font-semibold tracking-[0.12em] uppercase", style.text)}>{style.label}</span>
        {node.data.demo && (
          <Badge variant="outline" className="border-amber-400/30 text-amber-200/80">
            Demo
          </Badge>
        )}
        <div className="ml-auto flex items-center">
          <Button variant="ghost" size="icon-sm" aria-label="Collapse panel" title="Collapse panel" onClick={onCollapsePanel}>
            <PanelRightClose />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Close details" title="Close (Esc)" onClick={onClose}>
            <X />
          </Button>
        </div>
      </div>

      <div key={node.id} className="rh-scroll rh-fade-in min-h-0 flex-1 space-y-5 overflow-x-hidden overflow-y-auto p-4">
        <div>
          <h2 className="text-base leading-snug font-semibold tracking-tight break-words">{node.data.label}</h2>
          {node.data.description && (
            <p className="mt-2 text-sm leading-relaxed break-words text-muted-foreground">{node.data.description}</p>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Button variant="outline" size="xs" onClick={onCenter}>
            <Crosshair /> Center
          </Button>
          {branch.children > 0 && (
            <Button variant="outline" size="xs" onClick={onToggleBranch}>
              {branch.collapsed ? <UnfoldVertical /> : <FoldVertical />}
              {branch.collapsed ? `Expand branch (${branch.hidden})` : "Collapse branch"}
            </Button>
          )}
          {pinned && (
            <Button variant="outline" size="xs" onClick={onUnpin} title="Return to its auto-layout position">
              <PinOff /> Reset position
            </Button>
          )}
        </div>

        <dl className="space-y-4 empty:hidden">
          <KindFields node={node} />
        </dl>

        {connections.length > 0 && (
          <div>
            <h3 className="mb-2 text-[11px] tracking-wide text-muted-foreground uppercase">
              Connections · {connections.length}
            </h3>
            <ul className="space-y-1.5">
              {shown.map(({ edge, outgoing, other }) => {
                const rel = RELATION_STYLES[edge.data!.relation];
                const otherStyle = KIND_STYLES[other!.type];
                return (
                  <li key={edge.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(other!.id)}
                      className="w-full rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 text-left transition-colors hover:border-white/15 hover:bg-white/[0.05]"
                    >
                      <span className="flex items-center gap-1.5 text-[11px]" style={{ color: rel.color }}>
                        {outgoing ? <ArrowRight className="size-3" /> : <ArrowLeft className="size-3" />}
                        {outgoing ? rel.label : `${rel.label} (incoming)`}
                      </span>
                      <span className="mt-1 flex min-w-0 items-start gap-2 text-xs text-foreground/90">
                        <span className={cn("mt-1 size-1.5 shrink-0 rounded-full", otherStyle.dot)} />
                        <span className="line-clamp-2 break-words">{other!.data.label}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {connections.length > CONNECTIONS_PREVIEW && (
              <button
                type="button"
                onClick={() => setShowAll(!showAll)}
                className="mt-2 text-xs text-muted-foreground hover:text-foreground"
              >
                {showAll ? "Show less" : `Show ${connections.length - CONNECTIONS_PREVIEW} more`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
