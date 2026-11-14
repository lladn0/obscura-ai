"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Loader2, Network, PenLine, Plus, Trash2, X } from "lucide-react";

import { isBoardResearching } from "@/agents/research/use-research-agent";
import { createBoard, deleteBoard, listBoards, onBoardsChange, renameBoard, type BoardMeta } from "@/graph/board-store";
import { Button } from "@/components/ui/button";

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

function Status({ board }: { board: BoardMeta }) {
  if (isBoardResearching(board.id))
    return (
      <span className="flex items-center gap-1 text-sky-300">
        <Loader2 className="size-3 animate-spin" /> Researching
      </span>
    );
  if (board.research === "completed") return <span className="text-emerald-300/90">Research complete</span>;
  if (board.research === "failed") return <span className="text-rose-300/90">Research failed</span>;
  if (board.research === "running") return <span className="text-amber-300/90">Interrupted</span>;
  return <span className="text-muted-foreground">No research yet</span>;
}

function BoardCard({ board }: { board: BoardMeta }) {
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(board.title);
  const [confirm, setConfirm] = useState(false);

  return (
    <div className="group relative flex flex-col rounded-2xl border border-white/[0.07] bg-card/60 p-4 transition-colors hover:border-violet-400/25">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/10 text-violet-200">
          <Network className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          {renaming ? (
            <form
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (title.trim()) renameBoard(board.id, title.trim());
                setRenaming(false);
              }}
            >
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setRenaming(false)}
                className="h-7 min-w-0 flex-1 rounded-md border border-white/15 bg-background/60 px-2 text-sm outline-none focus:border-white/30"
              />
              <Button type="submit" variant="ghost" size="icon-xs" aria-label="Save name">
                <Check />
              </Button>
              <Button type="button" variant="ghost" size="icon-xs" aria-label="Cancel" onClick={() => setRenaming(false)}>
                <X />
              </Button>
            </form>
          ) : (
            <Link
              href={`/boards/${board.id}`}
              className="line-clamp-2 font-medium leading-snug after:absolute after:inset-0 after:content-['']"
              title={board.title}
            >
              {board.title}
            </Link>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            {board.nodeCount} node{board.nodeCount === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
        <div>
          <dt className="text-muted-foreground/70">Created</dt>
          <dd className="text-foreground/80">{fmt(board.createdAt)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground/70">Modified</dt>
          <dd className="text-foreground/80">{fmtTime(board.updatedAt)}</dd>
        </div>
      </dl>

      <div className="relative z-10 mt-4 flex items-center gap-1 border-t border-white/[0.06] pt-3 text-[11px]">
        <Status board={board} />
        {confirm ? (
          <span className="ml-auto flex items-center gap-1">
            <span className="text-rose-200/90">Delete?</span>
            <Button variant="destructive" size="xs" onClick={() => deleteBoard(board.id)}>
              Delete
            </Button>
            <Button variant="ghost" size="xs" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
          </span>
        ) : (
          <span className="ml-auto flex items-center md:opacity-70 md:transition-opacity md:group-hover:opacity-100">
            <Button variant="ghost" size="icon-sm" className="size-9 md:size-7" aria-label="Rename board" title="Rename" onClick={() => setRenaming(true)}>
              <PenLine />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-9 hover:text-rose-300 md:size-7"
              aria-label="Delete board"
              title="Delete"
              onClick={() => setConfirm(true)}
            >
              <Trash2 />
            </Button>
          </span>
        )}
      </div>
    </div>
  );
}

export default function BoardsList() {
  const router = useRouter();
  const [boards, setBoards] = useState<BoardMeta[]>(listBoards);
  useEffect(() => onBoardsChange(() => setBoards(listBoards())), []);

  const create = () => router.push(`/boards/${createBoard().id}`);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:py-10">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Boards</h1>
          <p className="mt-1 text-sm text-muted-foreground">Your research boards, saved in this browser.</p>
        </div>
        <Button onClick={create} className="rounded-xl">
          <Plus /> New Board
        </Button>
      </div>

      {boards.length === 0 ? (
        <div className="mt-16 flex flex-col items-center rounded-2xl border border-dashed border-white/10 px-6 py-16 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/10 text-violet-200">
            <Network className="size-6" />
          </span>
          <h2 className="mt-4 font-medium">No boards yet</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Create a board and ask a question: the research agents will map it into a knowledge graph.
          </p>
          <Button onClick={create} className="mt-6 rounded-xl">
            <Plus /> Create Board
          </Button>
        </div>
      ) : (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 md:mt-8 md:gap-4 lg:grid-cols-3">
          {boards.map((b) => (
            <BoardCard key={b.id} board={b} />
          ))}
        </div>
      )}
    </div>
  );
}
