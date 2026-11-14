"use client";

import Link from "next/link";

import { getBoardMeta } from "@/graph/board-store";
import Workspace from "@/components/board/workspace";
import { buttonVariants } from "@/components/ui/button";

/** The research workspace for one saved board (full screen; compact link back to Boards). */
export default function BoardView({ id }: { id: string }) {
  if (!getBoardMeta(id))
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-background text-center">
        <p className="text-sm text-muted-foreground">This board doesn&apos;t exist (it may have been deleted).</p>
        <Link href="/boards" className={buttonVariants({ variant: "outline" })}>
          Back to Boards
        </Link>
      </div>
    );
  return <Workspace boardId={id} />;
}
