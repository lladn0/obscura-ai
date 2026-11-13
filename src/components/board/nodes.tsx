"use client";

import { memo, type ReactNode } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
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
import { KIND_STYLES } from "./styles";

function Shell({
  kind,
  selected,
  label,
  description,
  meta,
  footer,
  className,
  labelClassName,
}: {
  kind: NodeKind;
  selected?: boolean;
  label: string;
  description?: string;
  meta?: ReactNode;
  footer?: ReactNode;
  className?: string;
  labelClassName?: string;
}) {
  const style = KIND_STYLES[kind];
  const Icon = style.icon;
  return (
    <div
      style={{ width: NODE_WIDTH[kind] }}
      className={cn(
        "rh-node-card group relative rounded-xl border bg-card/95 px-3.5 py-3 shadow-[0_8px_24px_-12px_rgb(0_0_0/0.6)] backdrop-blur-sm",
        "transition-[box-shadow,border-color,transform] duration-200 hover:-translate-y-px hover:border-white/20",
        style.border,
        selected && cn("ring-2", style.ring),
        className,
      )}
    >
      {/* Edges are "floating" (see relation-edge.tsx); handles only anchor them. */}
      <Handle type="target" position={Position.Left} className="rh-handle" isConnectable={false} />
      <Handle type="source" position={Position.Right} className="rh-handle" isConnectable={false} />

      <div className="mb-2 flex items-center gap-2">
        <span className={cn("flex size-5 items-center justify-center rounded-md", style.chip)}>
          <Icon className="size-3" />
        </span>
        <span className={cn("text-[10px] font-semibold tracking-[0.12em] uppercase", style.text)}>
          {style.label}
        </span>
        {meta && <span className="ml-auto flex items-center gap-1">{meta}</span>}
      </div>
      <p className={cn("text-[13px] leading-snug font-medium text-foreground", labelClassName)}>
        {label}
      </p>
      {description && (
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
      {footer && <div className="mt-2.5">{footer}</div>}
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
    <div className="flex items-center gap-2">
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

const QuestionNodeView = memo(function QuestionNodeView({ data, selected }: NodeProps<QuestionNode>) {
  return (
    <Shell
      kind="question"
      selected={selected}
      label={data.label}
      description={data.description}
      className="bg-gradient-to-br from-violet-500/12 via-card/95 to-card/95 px-4 py-3.5"
      labelClassName="text-[15px] font-semibold tracking-tight"
      meta={data.status && <Pill className="capitalize">{data.status}</Pill>}
    />
  );
});

const ClaimNodeView = memo(function ClaimNodeView({ data, selected }: NodeProps<ClaimNode>) {
  return (
    <Shell
      kind="claim"
      selected={selected}
      label={data.label}
      description={data.description}
      meta={data.contested && <Pill className="border-rose-400/30 text-rose-300">Contested</Pill>}
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

const EvidenceNodeView = memo(function EvidenceNodeView({ data, selected }: NodeProps<EvidenceNode>) {
  return (
    <Shell
      kind="evidence"
      selected={selected}
      label={data.label}
      description={data.description}
      meta={
        data.stance && (
          <Pill className={cn("capitalize", STANCE_PILL[data.stance])}>{data.stance}</Pill>
        )
      }
    />
  );
});

const SourceNodeView = memo(function SourceNodeView({ data, selected }: NodeProps<SourceNode>) {
  const byline = [data.publisher, data.year].filter(Boolean).join(" · ");
  return (
    <Shell
      kind="source"
      selected={selected}
      label={data.label}
      className="bg-card/80"
      meta={data.sourceType && <Pill className="capitalize">{data.sourceType}</Pill>}
      footer={byline && <p className="font-mono text-[10px] text-muted-foreground">{byline}</p>}
    />
  );
});

const InsightNodeView = memo(function InsightNodeView({ data, selected }: NodeProps<InsightNode>) {
  return (
    <Shell
      kind="insight"
      selected={selected}
      label={data.label}
      description={data.description}
      className="bg-gradient-to-br from-emerald-500/12 via-card/95 to-card/95"
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
