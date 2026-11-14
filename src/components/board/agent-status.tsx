"use client";

import { AlertCircle, Check, GitBranch, Loader2, Network, Search } from "lucide-react";

import type { ResearchPhase, ResearchState } from "@/agents/research/protocol";
import type { UsageTotals } from "@/agents/research/use-research-agent";
import { cn } from "@/lib/utils";

const PHASES: Record<ResearchPhase, { label: string; icon: typeof Check; className: string }> = {
  planning: { label: "Planning", icon: GitBranch, className: "text-violet-300" },
  researching: { label: "Researching", icon: Search, className: "text-sky-300" },
  structuring: { label: "Structuring", icon: Network, className: "text-amber-300" },
  completed: { label: "Completed", icon: Check, className: "text-emerald-300" },
  error: { label: "Error", icon: AlertCircle, className: "text-rose-300" },
};

const SHOW_COSTS = process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_SHOW_COSTS === "1";

/** Development-only: estimated Anthropic cost and Firecrawl credits for the current run. */
export function CostIndicator({ usage }: { usage: UsageTotals }) {
  if (!SHOW_COSTS || (!usage.llmRequests && !usage.firecrawlCredits)) return null;
  return (
    <div
      title={`Estimated. ${usage.inputTokens.toLocaleString()} input / ${usage.outputTokens.toLocaleString()} output tokens`}
      className="flex h-7 items-center gap-1.5 rounded-lg border border-dashed border-white/10 px-2 font-mono text-[10px] text-muted-foreground tabular-nums"
    >
      <span className="text-foreground/80">${usage.llmCostUsd.toFixed(4)}</span>
      <span>· {usage.llmRequests} req</span>
      <span>· {usage.firecrawlCredits} fc cr</span>
    </div>
  );
}

/** Compact agent activity pill: phase plus branch progress. */
export function AgentStatus({
  research,
  running,
  error,
}: {
  research: ResearchState | null;
  running: boolean;
  error: string | null;
}) {
  if (!research && !error) return null;
  const phase: ResearchPhase = error ? "error" : (research?.phase ?? "planning");
  const { label, icon: Icon, className } = PHASES[phase];
  const branches = Object.values(research?.branches ?? {});
  const done = branches.filter((b) => b.status === "done").length;
  const active = branches.filter((b) => b.status === "researching").map((b) => b.label);

  return (
    <div
      role="status"
      aria-live="polite"
      title={error ?? (active.length ? `Researching: ${active.join(", ")}` : undefined)}
      className="rh-fade-in flex h-7 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-2 text-[11px] font-medium"
    >
      {running && phase !== "completed" && phase !== "error" ? (
        <Loader2 className={cn("size-3.5 animate-spin", className)} />
      ) : (
        <Icon className={cn("size-3.5", className)} />
      )}
      <span className={className}>{label}</span>
      {branches.length > 0 && phase !== "error" && (
        <span className="text-muted-foreground tabular-nums">
          {done}/{branches.length}
        </span>
      )}
    </div>
  );
}
