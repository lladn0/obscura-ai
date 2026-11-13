"use client";

import dynamic from "next/dynamic";

// The board reads localStorage on first render, so it is client-only.
const Workspace = dynamic(() => import("@/components/board/workspace"), {
  ssr: false,
  loading: () => <div className="h-screen bg-background" />,
});

export default function Home() {
  return <Workspace />;
}
