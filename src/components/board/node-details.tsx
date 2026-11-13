"use client";

import { ArrowLeft, ArrowRight, MousePointerClick } from "lucide-react";

import type { ResearchEdge, ResearchNode } from "@/graph/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ConfidenceBar } from "./nodes";
import { KIND_STYLES, RELATION_STYLES } from "./styles";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="text-sm text-foreground/90">{children}</dd>
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

export function NodeDetails({
  node,
  nodes,
  edges,
  onSelect,
}: {
  node: ResearchNode | null;
  nodes: ResearchNode[];
  edges: ResearchEdge[];
  onSelect: (id: string) => void;
}) {
  if (!node) {
    return (
      <aside className="flex w-80 shrink-0 flex-col items-center justify-center gap-3 border-l border-white/[0.06] bg-sidebar/60 p-6 text-center">
        <span className="flex size-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03]">
          <MousePointerClick className="size-4 text-muted-foreground" />
        </span>
        <p className="text-sm text-foreground/90">Select a node</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Click any card on the board to see its details and connections.
        </p>
      </aside>
    );
  }

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

  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-white/[0.06] bg-sidebar/60">
      <div key={node.id} className="rh-fade-in space-y-5 p-5">
        <div className="flex items-center gap-2">
          <span className={cn("flex size-7 items-center justify-center rounded-lg", style.chip)}>
            <Icon className="size-4" />
          </span>
          <span className={cn("text-xs font-semibold tracking-[0.12em] uppercase", style.text)}>{style.label}</span>
          {node.data.demo && (
            <Badge variant="outline" className="ml-auto border-amber-400/30 text-amber-200/80">
              Demo data
            </Badge>
          )}
        </div>

        <div>
          <h2 className="text-lg leading-snug font-semibold tracking-tight">{node.data.label}</h2>
          {node.data.description && (
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{node.data.description}</p>
          )}
        </div>

        <dl className="space-y-4">
          <KindFields node={node} />
        </dl>

        <div>
          <h3 className="mb-2 text-[11px] tracking-wide text-muted-foreground uppercase">
            Connections · {connections.length}
          </h3>
          <ul className="space-y-1.5">
            {connections.map(({ edge, outgoing, other }) => {
              const rel = RELATION_STYLES[edge.data!.relation];
              const otherStyle = KIND_STYLES[other!.type];
              return (
                <li key={edge.id}>
                  <button
                    onClick={() => onSelect(other!.id)}
                    className="w-full rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 text-left transition-colors hover:border-white/15 hover:bg-white/[0.05]"
                  >
                    <span className="flex items-center gap-1.5 text-[11px]" style={{ color: rel.color }}>
                      {outgoing ? <ArrowRight className="size-3" /> : <ArrowLeft className="size-3" />}
                      {outgoing ? rel.label : `${rel.label} (incoming)`}
                    </span>
                    <span className="mt-1 flex items-start gap-2 text-xs text-foreground/90">
                      <span className={cn("mt-1 size-1.5 shrink-0 rounded-full", otherStyle.dot)} />
                      {other!.data.label}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </aside>
  );
}
