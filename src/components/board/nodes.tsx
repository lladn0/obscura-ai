"use client";

import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ChevronDown, ExternalLink, Loader2, Minus, PenLine, X } from "lucide-react";
import { cn } from "@/lib/utils";

import { NODE_WIDTH } from "@/graph/layout";
import type {
  ClaimNode,
  EvidenceNode,
  ImageFields,
  InsightNode,
  NodeKind,
  NoteNode,
  QuestionNode,
  SourceNode,
} from "@/graph/types";
import { useBoardView, useBranch } from "./board-context";
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

/** Full-size image with attribution, opened from a node's thumbnail. */
export function ImageLightbox({ image, onClose }: { image: ImageFields; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div
      className="rh-fade-in fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <figure
        className="relative flex max-h-full max-w-3xl flex-col overflow-hidden rounded-xl border border-white/10 bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close image"
          className="absolute top-2 right-2 flex size-7 items-center justify-center rounded-md bg-black/50 text-white/80 hover:text-white"
        >
          <X className="size-4" />
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image.imageUrl} alt={image.imageAlt ?? ""} className="max-h-[75vh] min-h-0 bg-white/[0.03] object-contain" />
        <figcaption className="space-y-0.5 border-t border-white/10 px-3 py-2 text-xs text-muted-foreground">
          {image.imageAlt && <p className="text-foreground/90">{image.imageAlt}</p>}
          <ImageCredit image={image} />
        </figcaption>
      </figure>
    </div>,
    document.body,
  );
}

export function ImageCredit({ image }: { image: ImageFields }) {
  return (
    <p className="flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
      <span className="truncate">{image.imageCredit || "Wikimedia Commons"}</span>
      {image.imageSourceUrl && (
        <a
          href={image.imageSourceUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="nodrag inline-flex shrink-0 items-center gap-0.5 text-sky-300/80 hover:text-sky-200"
        >
          source <ExternalLink className="size-2.5" />
        </a>
      )}
    </p>
  );
}

/** Compact, fixed-height preview so loading never shifts the card's layout. */
function NodeImage({ image }: { image: ImageFields }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  if (image.imageStatus === "loading" || image.imageStatus === "pending")
    return image.imageNeeded ? <div className="mt-2 h-24 animate-pulse rounded-lg bg-white/[0.04]" aria-label="Loading image" /> : null;
  if (!image.imageUrl || failed) return null;
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        title="Open larger image"
        className="nodrag mt-2 block h-24 w-full overflow-hidden rounded-lg border border-white/[0.06] bg-white/[0.04]"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image.imageUrl}
          alt={image.imageAlt ?? ""}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="size-full object-contain opacity-90 transition-opacity hover:opacity-100"
        />
      </button>
      <div className="mt-1">
        <ImageCredit image={image} />
      </div>
      {open && <ImageLightbox image={image} onClose={() => setOpen(false)} />}
    </>
  );
}

/** In-place title/description editor. Enter saves the title, Esc cancels, blur saves. */
function NodeEditor({ id, label, description }: { id: string; label: string; description?: string }) {
  const { saveEdit, setEditing } = useBoardView();
  const [title, setTitle] = useState(label);
  const [body, setBody] = useState(description ?? "");
  const titleRef = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    titleRef.current?.focus();
    titleRef.current?.select();
  }, []);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save && (title.trim() !== label || body.trim() !== (description ?? "")))
      saveEdit(id, { label: title.trim() || label, description: body.trim() || undefined });
    setEditing(null);
  };
  return (
    <div
      className="nodrag nowheel space-y-1.5"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) finish(true);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") finish(false);
        if (e.key === "Enter" && (e.target === titleRef.current || e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          finish(true);
        }
      }}
    >
      <input
        ref={titleRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        className="w-full rounded-md border border-white/15 bg-background/60 px-1.5 py-1 text-[13px] font-medium text-foreground outline-none focus:border-white/30"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Description"
        rows={3}
        className="w-full resize-none rounded-md border border-white/15 bg-background/60 px-1.5 py-1 text-xs leading-relaxed text-foreground/90 outline-none focus:border-white/30"
      />
      <p className="text-[10px] text-muted-foreground">Enter to save · Esc to cancel</p>
    </div>
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
  image,
  edited,
  alwaysOpen,
}: {
  id: string;
  generating?: boolean;
  image?: ImageFields;
  edited?: boolean;
  /** Show the description without the expand toggle (notes). */
  alwaysOpen?: boolean;
  kind: NodeKind;
  selected?: boolean;
  label: string;
  description?: string;
  meta?: ReactNode;
  footer?: ReactNode;
  className?: string;
  labelClassName?: string;
}) {
  const [expanded, setOpen] = useState(false);
  const open = expanded || !!alwaysOpen;
  const style = KIND_STYLES[kind];
  const Icon = style.icon;
  const view = useBoardView();
  const busy = view.busy.has(id);
  const editing = view.editingId === id;
  return (
    <div
      style={{ width: NODE_WIDTH[kind] }}
      className={cn(
        "rh-node-card group relative rounded-xl border bg-card/95 px-3 py-2.5 shadow-[0_8px_24px_-12px_rgb(0_0_0/0.6)] backdrop-blur-sm",
        "transition-[box-shadow,border-color] duration-200 hover:border-white/20",
        style.border,
        selected && cn("ring-2", style.ring),
        busy && "rh-busy",
        className,
      )}
    >
      {/* Edges are "floating" (see relation-edge.tsx); handles only anchor them. */}
      <Handle type="target" position={Position.Top} className="rh-handle" />
      <Handle type="source" position={Position.Bottom} className="rh-handle" />
      {/* In Connect mode this covers the card: drag from any card onto another. */}
      <Handle type="source" id="connect" position={Position.Top} className="rh-handle rh-handle-full" />

      <div className="mb-1.5 flex items-center gap-1.5">
        <span className={cn("flex size-4.5 items-center justify-center rounded-md", style.chip)}>
          <Icon className="size-3" />
        </span>
        <span className={cn("text-[10px] font-semibold tracking-[0.12em] uppercase", style.text)}>
          {style.label}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {meta}
          {edited && (
            <span title="Edited by you: research updates won't overwrite it" className="text-muted-foreground/70">
              <PenLine className="size-3" />
            </span>
          )}
          {busy && <Loader2 className="size-3.5 animate-spin text-sky-300" aria-label="Investigating" />}
          {generating && (
            <span className="relative flex size-2" title="Generating">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-sky-400/60" />
              <span className="relative inline-flex size-2 rounded-full bg-sky-400" />
            </span>
          )}
          {description && !generating && !alwaysOpen && (
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
      {editing ? (
        <NodeEditor id={id} label={label} description={description} />
      ) : label || !generating ? (
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
      {!editing && (open || generating) && description && (
        <p className="mt-1.5 text-xs leading-relaxed break-words text-muted-foreground">
          {description}
          {generating && <span className="rh-caret" />}
        </p>
      )}
      {image && <NodeImage image={image} />}
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
      image={data}
      edited={data.userEdited}
      kind="question"
      selected={selected}
      label={data.label}
      description={data.description}
      className={cn(
        "bg-gradient-to-br via-card/95 to-card/95",
        data.gap ? "border-dashed from-violet-500/5" : "from-violet-500/15 px-3.5 py-3",
      )}
      labelClassName={data.gap ? undefined : "text-[15px] font-semibold tracking-tight"}
      meta={data.gap && <Pill className="border-violet-400/30 text-violet-300">Gap</Pill>}
    />
  );
});

const CHALLENGE_PILL = {
  contradiction: "border-rose-400/40 bg-rose-400/10 text-rose-200",
  alternative: "border-violet-400/40 bg-violet-400/10 text-violet-200",
} as const;

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
      image={data}
      edited={data.userEdited}
      kind="claim"
      selected={selected}
      label={data.label}
      description={data.description}
      meta={
        data.challenge ? (
          <Pill className={CHALLENGE_PILL[data.challenge]}>
            {data.challenge === "contradiction" ? "Contradiction" : "Alternative view"}
          </Pill>
        ) : data.verification ? (
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
      image={data}
      edited={data.userEdited}
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
      image={data}
      edited={data.userEdited}
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
      image={data}
      edited={data.userEdited}
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

const NoteNodeView = memo(function NoteNodeView({ id, data, selected }: NodeProps<NoteNode>) {
  return (
    <Shell
      id={id}
      kind="note"
      selected={selected}
      label={data.label}
      description={data.description}
      alwaysOpen
      image={data}
      className="bg-gradient-to-br from-yellow-300/[0.07] via-card/95 to-card/95"
    />
  );
});

export const nodeTypes = {
  note: NoteNodeView,
  question: QuestionNodeView,
  claim: ClaimNodeView,
  evidence: EvidenceNodeView,
  source: SourceNodeView,
  insight: InsightNodeView,
};
