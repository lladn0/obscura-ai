"use client";

import { memo, useState, type ReactNode } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ChevronDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

import { NODE_WIDTH } from "@/graph/layout";
import type {
  ClaimNode,
  EvidenceNode,
  InsightNode,
  NodeKind,
  QuestionNode,
  SourceNode,
} from "@/graph/types";
import { useBranch } from "./board-context";
import { KIND_STYLES } from "./styles";

/** Fold/unfold the branch below a node. Always visible when folded, on hover otherwise. */
function BranchToggle({ id, selected }: { id: string; selected?: boolean }) {
  const branch = useBranch(id);
  if (!branch.children) return null;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        branch.toggle();
      }}
      aria-label={branch.collapsed ? `Expand ${branch.hidden} hidden nodes` : "Collapse branch"}
      title={branch.collapsed ? `Show ${branch.hidden} more` : "Collapse branch"}
      className={cn(
        "nodrag absolute -bottom-2.5 left-1/2 flex h-5 min-w-5 -translate-x-1/2 items-center justify-center gap-0.5 rounded-full border border-white/15 bg-background px-1.5 text-[10px] font-medium text-muted-foreground shadow-sm transition-[opacity,color,border-color] hover:border-white/30 hover:text-foreground",
        !branch.collapsed && !selected && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
      )}
    >
      {branch.collapsed ? `+${branch.hidden}` : <Minus className="size-3" />}
    </button>
  );
}

function Shell({
  id,
  kind,
  selected,
  label,
  description,
  meta,
  footer,
  className,
  labelClassName,
  generating,
}: {
  id: string;
  generating?: boolean;
  kind: NodeKind;
  selected?: boolean;
  label: string;
  description?: string;
  meta?: ReactNode;
  footer?: ReactNode;
  className?: string;
  labelClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const style = KIND_STYLES[kind];
  const Icon = style.icon;
  return (
    <div
      style={{ width: NODE_WIDTH[kind] }}
      className={cn(
        "rh-node-card group relative rounded-xl border bg-card/95 px-3 py-2.5 shadow-[0_8px_24px_-12px_rgb(0_0_0/0.6)] backdrop-blur-sm",
        "transition-[box-shadow,border-color] duration-200 hover:border-white/20",
        style.border,
        selected && cn("ring-2", style.ring),
        className,
      )}
    >
      {/* Edges are "floating" (see relation-edge.tsx); handles only anchor them. */}
      <Handle type="target" position={Position.Top} className="rh-handle" isConnectable={false} />
      <Handle type="source" position={Position.Bottom} className="rh-handle" isConnectable={false} />

      <div className="mb-1.5 flex items-center gap-1.5">
        <span className={cn("flex size-4.5 items-center justify-center rounded-md", style.chip)}>
          <Icon className="size-3" />
        </span>
        <span className={cn("text-[10px] font-semibold tracking-[0.12em] uppercase", style.text)}>
          {style.label}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {meta}
          {generating && (
            <span className="relative flex size-2" title="Generating">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-sky-400/60" />
              <span className="relative inline-flex size-2 rounded-full bg-sky-400" />
            </span>
          )}
          {description && !generating && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setOpen((o) => !o);
              }}
              aria-expanded={open}
              aria-label={open ? "Hide summary" : "Show summary"}
              title={open ? "Hide summary" : "Show summary"}
              className="nodrag -mr-1 flex size-5 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-white/5 hover:text-foreground"
            >
              <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
            </button>
          )}
        </span>
      </div>
      {label || !generating ? (
        <p
          className={cn(
            "text-[13px] leading-snug font-medium break-words text-foreground",
            !open && !generating && "line-clamp-3",
            labelClassName,
          )}
        >
          {label}
          {generating && !description && <span className="rh-caret" />}
        </p>
      ) : (
        <div className="space-y-1.5 py-1" aria-label="Generating">
          <div className="h-2.5 w-4/5 animate-pulse rounded bg-white/10" />
          <div className="h-2.5 w-1/2 animate-pulse rounded bg-white/10" />
        </div>
      )}
      {(open || generating) && description && (
        <p className="mt-1.5 text-xs leading-relaxed break-words text-muted-foreground">
          {description}
          {generating && <span className="rh-caret" />}
        </p>
      )}
      {footer && <div className="mt-2">{footer}</div>}
      <BranchToggle id={id} selected={selected} />
    </div>
  );
}

function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "rounded-full border border-white/10 px-1.5 py-px text-[10px] leading-4 text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function ConfidenceBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className="flex items-center gap-2" title={`Confidence ${Math.round(value * 100)}%`}>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/8">
        <div
          className={cn("h-full rounded-full transition-[width] duration-500", className)}
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      </div>
      <span className="text-[10px] text-muted-foreground tabular-nums">
        {Math.round(value * 100)}%
      </span>
    </div>
  );
}

const QuestionNodeView = memo(function QuestionNodeView({ id, data, selected }: NodeProps<QuestionNode>) {
  return (
    <Shell
      id={id}
      generating={data.generating}
      kind="question"
      selected={selected}
      label={data.label}
      description={data.description}
      className="bg-gradient-to-br from-violet-500/15 via-card/95 to-card/95 px-3.5 py-3"
      labelClassName="text-[15px] font-semibold tracking-tight"
    />
  );
});

export const VERIFICATION_PILL = {
  verified: "border-emerald-400/30 text-emerald-300 capitalize",
  unverified: "border-amber-400/30 text-amber-300 capitalize",
  contested: "border-rose-400/30 text-rose-300 capitalize",
} as const;

const ClaimNodeView = memo(function ClaimNodeView({ id, data, selected }: NodeProps<ClaimNode>) {
  return (
    <Shell
      id={id}
      generating={data.generating}
      kind="claim"
      selected={selected}
      label={data.label}
      description={data.description}
      meta={
        data.verification ? (
          <Pill className={VERIFICATION_PILL[data.verification]}>{data.verification}</Pill>
        ) : (
          data.contested && <Pill className="border-rose-400/30 text-rose-300">Contested</Pill>
        )
      }
      footer={
        data.confidence !== undefined && (
          <ConfidenceBar value={data.confidence} className="bg-sky-400/80" />
        )
      }
    />
  );
});

const STANCE_PILL = {
  supporting: "border-emerald-400/30 text-emerald-300",
  conflicting: "border-rose-400/30 text-rose-300",
  neutral: "",
} as const;

const EvidenceNodeView = memo(function EvidenceNodeView({ id, data, selected }: NodeProps<EvidenceNode>) {
  return (
    <Shell
      id={id}
      generating={data.generating}
      kind="evidence"
      selected={selected}
      label={data.label}
      description={data.description}
      meta={
        data.stance &&
        data.stance !== "neutral" && (
          <Pill className={cn("capitalize", STANCE_PILL[data.stance])}>{data.stance}</Pill>
        )
      }
    />
  );
});

const SourceNodeView = memo(function SourceNodeView({ id, data, selected }: NodeProps<SourceNode>) {
  const byline = [data.publisher, data.year].filter(Boolean).join(" · ");
  return (
    <Shell
      id={id}
      generating={data.generating}
      kind="source"
      selected={selected}
      label={data.label}
      description={data.description}
      className="bg-card/80"
      footer={byline && <p className="font-mono text-[10px] text-muted-foreground">{byline}</p>}
    />
  );
});

const InsightNodeView = memo(function InsightNodeView({ id, data, selected }: NodeProps<InsightNode>) {
  return (
    <Shell
      id={id}
      generating={data.generating}
      kind="insight"
      selected={selected}
      label={data.label}
      description={data.description}
      className="bg-gradient-to-br from-emerald-500/15 via-card/95 to-card/95"
      footer={
        data.confidence !== undefined && (
          <ConfidenceBar value={data.confidence} className="bg-emerald-400/80" />
        )
      }
    />
  );
});

export const nodeTypes = {
  question: QuestionNodeView,
  claim: ClaimNodeView,
  evidence: EvidenceNodeView,
  source: SourceNodeView,
  insight: InsightNodeView,
};
