import {
  CircleHelp,
  FileSearch,
  Lightbulb,
  Library,
  MessageSquareQuote,
  StickyNote,
  type LucideIcon,
} from "lucide-react";

import type { EdgeRelation, NodeKind } from "@/graph/types";

type KindStyle = {
  label: string;
  icon: LucideIcon;
  /** icon chip */
  chip: string;
  /** accent text */
  text: string;
  /** card border + selected ring */
  border: string;
  ring: string;
  /** legend / small dot */
  dot: string;
};

export const KIND_STYLES: Record<NodeKind, KindStyle> = {
  question: {
    label: "Question",
    icon: CircleHelp,
    chip: "bg-violet-500/15 text-violet-300",
    text: "text-violet-300",
    border: "border-violet-400/30",
    ring: "ring-violet-400/70 shadow-[0_0_0_6px_rgb(167_139_250/0.12),0_12px_40px_-12px_rgb(167_139_250/0.5)]",
    dot: "bg-violet-400",
  },
  claim: {
    label: "Claim",
    icon: MessageSquareQuote,
    chip: "bg-sky-500/15 text-sky-300",
    text: "text-sky-300",
    border: "border-sky-400/20",
    ring: "ring-sky-400/70 shadow-[0_0_0_6px_rgb(56_189_248/0.12),0_12px_40px_-12px_rgb(56_189_248/0.45)]",
    dot: "bg-sky-400",
  },
  evidence: {
    label: "Evidence",
    icon: FileSearch,
    chip: "bg-amber-500/15 text-amber-300",
    text: "text-amber-300",
    border: "border-amber-400/20",
    ring: "ring-amber-400/70 shadow-[0_0_0_6px_rgb(251_191_36/0.1),0_12px_40px_-12px_rgb(251_191_36/0.4)]",
    dot: "bg-amber-400",
  },
  source: {
    label: "Source",
    icon: Library,
    chip: "bg-zinc-400/15 text-zinc-300",
    text: "text-zinc-300",
    border: "border-zinc-400/20",
    ring: "ring-zinc-300/60 shadow-[0_0_0_6px_rgb(212_212_216/0.08),0_12px_40px_-12px_rgb(212_212_216/0.3)]",
    dot: "bg-zinc-400",
  },
  insight: {
    label: "Insight",
    icon: Lightbulb,
    chip: "bg-emerald-500/15 text-emerald-300",
    text: "text-emerald-300",
    border: "border-emerald-400/30",
    ring: "ring-emerald-400/70 shadow-[0_0_0_6px_rgb(52_211_153/0.12),0_12px_40px_-12px_rgb(52_211_153/0.5)]",
    dot: "bg-emerald-400",
  },
  note: {
    label: "Note",
    icon: StickyNote,
    chip: "bg-yellow-400/15 text-yellow-200",
    text: "text-yellow-200/90",
    border: "border-dashed border-yellow-300/30",
    ring: "ring-yellow-300/60 shadow-[0_0_0_6px_rgb(253_224_71/0.08),0_12px_40px_-12px_rgb(253_224_71/0.35)]",
    dot: "bg-yellow-300",
  },
};

/** Relationship choices offered for user-drawn connections. */
export const MANUAL_RELATIONS = ["related_to", "supports", "contradicts", "causes", "explains"] as const;

type RelationStyle = {
  label: string;
  color: string;
  width: number;
  dash?: string;
  directed: boolean;
  /** Animated flow particles along the edge. */
  flow?: boolean;
};

export const RELATION_STYLES: Record<EdgeRelation, RelationStyle> = {
  supports: { label: "supports", color: "#34d399", width: 1.6, directed: true },
  contradicts: { label: "contradicts", color: "#fb7185", width: 1.6, dash: "6 5", directed: true },
  causes: { label: "causes", color: "#fbbf24", width: 2.2, directed: true, flow: true },
  explains: { label: "explains", color: "#38bdf8", width: 1.6, directed: true },
  sourced_from: { label: "sourced from", color: "#a1a1aa", width: 1.4, dash: "1.5 5", directed: true },
  related_to: { label: "related to", color: "#71717a", width: 1.3, dash: "10 7", directed: false },
};
