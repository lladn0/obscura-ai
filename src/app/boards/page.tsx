"use client";

import dynamic from "next/dynamic";

import { SiteShell } from "@/components/site/site-nav";

// Boards live in localStorage, so the list renders on the client only.
const BoardsList = dynamic(() => import("@/components/site/boards-list"), { ssr: false });

export default function BoardsPage() {
  return (
    <SiteShell>
      <BoardsList />
    </SiteShell>
  );
}
