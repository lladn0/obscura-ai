import { Rabbit } from "lucide-react";

import { BoardCanvas } from "@/components/board/board-canvas";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2 font-semibold">
          <Rabbit className="size-5" />
          RabbitHole AI
        </div>
        <Button size="sm" disabled>
          New research
        </Button>
      </header>
      <div className="flex-1">
        <BoardCanvas />
      </div>
    </main>
  );
}
