"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";

// The board reads localStorage on first render, so it is client-only.
const BoardView = dynamic(() => import("@/components/site/board-view"), {
  ssr: false,
  loading: () => <div className="h-dvh bg-background" />,
});

export default function BoardPage() {
  const { id } = useParams<{ id: string }>();
  return <BoardView id={id} />;
}
