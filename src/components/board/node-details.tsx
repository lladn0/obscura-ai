"use client";

import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  FoldVertical,
  UnfoldVertical,
  Crosshair,
  PanelRightClose,
  ArrowUp,
  Loader2,
  PenLine,
  PinOff,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";

import { describeDepth } from "@/graph/research-depth";
import type { ResearchEdge, ResearchNode } from "@/graph/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ActionNote } from "@/agents/research/use-research-agent";
import type { NodeAction } from "@/agents/research/protocol";
import { EvidenceTrail, InvestigateActions } from "./node-investigate";
import { ImageCredit, ImageLightbox } from "./nodes";
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
      return null;
    case "evidence":
      return (
        <>
          {node.data.quote && (
            <Field label="Quote">
              <blockquote className="border-l-2 border-amber-400/40 pl-2.5 text-muted-foreground italic">
                {node.data.quote}
              </blockquote>
            </Field>
          )}
        </>
      );
    case "note":
      return null;
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

/** Always-visible follow-up input for a question or claim (Enter sends, Shift+Enter new line). */
function AskInline({ busy, onAsk }: { busy?: boolean; onAsk: (question: string) => void }) {
  const [text, setText] = useState("");
  const send = () => {
    const q = text.trim();
    if (!q || busy) return;
    onAsk(q);
    setText("");
  };
  return (
    <div className="flex items-end gap-1 rounded-lg border border-white/10 bg-background/60 p-1 transition-colors focus-within:border-violet-400/40">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        rows={1}
        placeholder="Ask a question about this..."
        aria-label="Ask a question about this"
        className="field-sizing-content max-h-28 min-h-7 min-w-0 flex-1 resize-none bg-transparent px-1.5 py-1 text-xs leading-relaxed outline-none placeholder:text-muted-foreground"
      />
      <Button
        size="icon-xs"
        className="mb-0.5 shrink-0"
        aria-label="Ask"
        title={busy ? "Researching follow-up…" : "Ask (Enter)"}
        onClick={send}
        disabled={!text.trim() || busy}
      >
        {busy ? <Loader2 className="animate-spin" /> : <ArrowUp />}
      </Button>
    </div>
  );
}

/** Extra instructions for later research on a question. */
function QuestionContext({ context, onSetContext }: { context: string; onSetContext: (context: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const save = () => {
    onSetContext(text.trim());
    setEditing(false);
  };
  if (!editing)
    return (
      <div className="space-y-1.5">
        {context && (
          <p className="rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-1.5 text-xs text-muted-foreground">
            <span className="text-foreground/80">Context:</span> {context}
          </p>
        )}
        <Button
          variant="outline"
          size="xs"
          onClick={() => {
            setText(context);
            setEditing(true);
          }}
          title="Extra instructions used for later research on this question"
        >
          <SlidersHorizontal /> {context ? "Edit context" : "Add context"}
        </Button>
      </div>
    );
  return (
    <div className="space-y-1.5">
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            save();
          } else if (e.key === "Escape") setEditing(false);
        }}
        rows={2}
        placeholder="e.g. Focus on the Lithuanian hackathon event, not the word “unfair”."
        className="w-full resize-none rounded-md border border-white/15 bg-background/60 px-2 py-1.5 text-xs leading-relaxed outline-none focus:border-white/30"
      />
      <div className="flex gap-1.5">
        <Button size="xs" onClick={save}>
          Save context
        </Button>
        <Button variant="ghost" size="xs" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Used for Deep Dives, follow-ups and other research on this question. Existing findings are kept.
      </p>
    </div>
  );
}

export type BranchInfo = { children: number; collapsed: boolean; hidden: number; descendants?: number };
const descendantCount = (b: BranchInfo) => b.descendants ?? b.children;

export function NodeDetails({
  node,
  nodes,
  edges,
  branch,
  researchDepth,
  pinned,
  investigate,
  onSelect,
  onCenter,
  onToggleBranch,
  onUnpin,
  onEdit,
  onDelete,
  onCollapsePanel,
  onClose,
  mobile,
}: {
  /** Inside the mobile bottom sheet: full width, no side-panel controls. */
  mobile?: boolean;
  node: ResearchNode;
  nodes: ResearchNode[];
  edges: ResearchEdge[];
  branch: BranchInfo;
  researchDepth: number;
  pinned: boolean;
  investigate: {
    active?: NodeAction;
    note?: ActionNote;
    onRun: (action: NodeAction) => void;
    onFollowUp: (question: string) => void;
    /** A follow-up asked from this node is being researched. */
    followUpBusy?: boolean;
    onSetContext: (context: string) => void;
  };
  onSelect: (id: string) => void;
  onCenter: () => void;
  onToggleBranch: () => void;
  onUnpin: () => void;
  onEdit: () => void;
  /** `withBranch` also deletes every research descendant. */
  onDelete: (withBranch: boolean) => void;
  onCollapsePanel: () => void;
  onClose: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [zoomImage, setZoomImage] = useState(false);
  const isNote = node.type === "note";
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
    <div className={cn("flex h-full min-h-0 flex-col overflow-hidden", mobile ? "w-full" : "w-80")}>
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
          {!mobile && (
            <Button variant="ghost" size="icon-sm" aria-label="Collapse panel" title="Collapse panel" onClick={onCollapsePanel}>
              <PanelRightClose />
            </Button>
          )}
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
          {node.data.userEdited && (
            <p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
              <PenLine className="size-3" /> Edited by you · research updates won&apos;t overwrite it
            </p>
          )}
        </div>

        {node.data.imageUrl && (
          <figure className="space-y-1">
            <button
              type="button"
              onClick={() => setZoomImage(true)}
              title="Open larger image"
              className="block w-full overflow-hidden rounded-lg border border-white/[0.06] bg-white/[0.04]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={node.data.imageUrl} alt={node.data.imageAlt ?? ""} loading="lazy" className="h-40 w-full object-contain" />
            </button>
            <figcaption>
              <ImageCredit image={node.data} />
            </figcaption>
            {zoomImage && <ImageLightbox image={node.data} onClose={() => setZoomImage(false)} />}
          </figure>
        )}

        <div className="flex flex-wrap gap-1.5">
          <Button variant="outline" size="xs" onClick={onEdit} title="Edit title and description (double-click the card)">
            <PenLine /> Edit
          </Button>
          {!confirmDelete ? (
            <Button
              variant="outline"
              size="xs"
              className="text-rose-300 hover:text-rose-200"
              title="Delete (Del)"
              onClick={() => (branch.children > 0 ? setConfirmDelete(true) : onDelete(false))}
            >
              <Trash2 /> Delete
            </Button>
          ) : (
            <div className="w-full space-y-1.5 rounded-lg border border-rose-400/20 bg-rose-400/[0.04] p-2.5">
              <p className="text-xs text-foreground/90">
                This node has {descendantCount(branch)} research nodes below it.
              </p>
              <div className="flex flex-wrap gap-1.5">
                <Button variant="outline" size="xs" onClick={() => onDelete(false)}>
                  Delete node, keep branch
                </Button>
                <Button variant="destructive" size="xs" onClick={() => onDelete(true)}>
                  Delete entire branch
                </Button>
                <Button variant="ghost" size="xs" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>

        <InvestigateActions node={node} active={investigate.active} note={investigate.note} onRun={investigate.onRun} />

        {(node.type === "question" || node.type === "claim") && (
          <AskInline key={node.id} busy={investigate.followUpBusy} onAsk={investigate.onFollowUp} />
        )}
        {node.type === "question" && (
          <QuestionContext
            key={`ctx-${node.id}`}
            context={node.data.context ?? ""}
            onSetContext={investigate.onSetContext}
          />
        )}

        <EvidenceTrail node={node} nodes={nodes} edges={edges} onSelect={onSelect} />

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

        <dl className="space-y-4">
          {isNote ? (
            <Field label="Type">Your note · floats freely, outside the research layout</Field>
          ) : (
            <Field label="Research depth">{describeDepth(researchDepth, node.type)}</Field>
          )}
          <KindFields node={node} />
        </dl>

        {connections.length > 0 && (
          <div>
            <h3 className="mb-2 text-[11px] tracking-wide text-muted-foreground uppercase">
              Connections · {connections.length}
            </h3>
            <ul className="space-y-1.5">
              {shown.map(({ edge, outgoing, other }) => {
                const rel = { ...RELATION_STYLES[edge.data!.relation] };
                if (edge.data!.label) rel.label = edge.data!.label;
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
