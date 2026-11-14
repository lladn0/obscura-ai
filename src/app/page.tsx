"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Bot, FileSearch, LayoutGrid, Network, Search, Telescope } from "lucide-react";

import { createBoard } from "@/graph/board-store";
import { Button, buttonVariants } from "@/components/ui/button";
import { SiteShell } from "@/components/site/site-nav";

const FEATURES = [
  {
    icon: Network,
    title: "Visual AI Research",
    text: "Any question becomes a live knowledge graph: directions, findings and sources stream in as the agents work.",
  },
  {
    icon: Telescope,
    title: "Interactive Deep Dive",
    text: "Open any branch one level deeper, ask follow-ups about a claim, or challenge it with counter-evidence.",
  },
  {
    icon: FileSearch,
    title: "Evidence & Sources",
    text: "Every finding is traced to real pages, with verified quotes and an evidence trail you can follow.",
  },
  {
    icon: Bot,
    title: "Research Copilot",
    text: "A conversational guide that knows your board and helps you plan what to explore next.",
    soon: true,
  },
];

const EXAMPLES = ["What caused the 2008 financial crisis?", "How does the human skull protect the brain?", "Why did the Bronze Age collapse?"];

export default function HomePage() {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const start = (q = question) => {
    const text = q.trim();
    if (!text) return inputRef.current?.focus();
    const board = createBoard(text);
    router.push(`/boards/${board.id}?q=${encodeURIComponent(text)}`);
  };

  return (
    <SiteShell>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,rgb(139_92_246/0.22),transparent_70%),radial-gradient(ellipse_40%_40%_at_80%_30%,rgb(217_70_239/0.12),transparent_70%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 [background-image:radial-gradient(rgb(255_255_255/0.06)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]"
        />
        <div className="relative mx-auto flex max-w-4xl flex-col items-center px-4 pt-20 pb-24 text-center sm:pt-28">
          <span className="mb-6 rounded-full border border-violet-400/25 bg-violet-400/[0.06] px-3 py-1 text-xs text-violet-200/90">
            Multi-agent research, mapped as you think
          </span>
          <h1 className="bg-gradient-to-b from-white to-white/60 bg-clip-text text-4xl font-semibold tracking-tight text-transparent sm:text-6xl">
            Research beyond the answer.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Transform complex questions into interactive knowledge graphs. Explore ideas, challenge claims, and discover
            connections with AI.
          </p>

          <form
            className="mt-10 w-full max-w-2xl"
            onSubmit={(e) => {
              e.preventDefault();
              start();
            }}
          >
            <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-card/80 p-2 shadow-[0_20px_60px_-20px_rgb(139_92_246/0.45)] backdrop-blur focus-within:border-violet-400/40">
              <Search className="ml-2 size-5 shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="What do you want to understand?"
                aria-label="What do you want to understand?"
                className="h-11 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground/70"
              />
              <Button type="submit" size="lg" className="hidden h-11 rounded-xl px-5 sm:flex">
                Start Exploring <ArrowRight />
              </Button>
            </div>
          </form>

          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => start(ex)}
                className="rounded-full border border-white/[0.08] px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-white/20 hover:text-foreground"
              >
                {ex}
              </button>
            ))}
          </div>

          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Button size="lg" className="h-11 rounded-xl px-6" onClick={() => start()}>
              Start Exploring <ArrowRight />
            </Button>
            <Link href="/boards" className={buttonVariants({ size: "lg", variant: "outline", className: "h-11 rounded-xl px-6" })}>
              <LayoutGrid /> My Boards
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-white/[0.06] bg-white/[0.01]">
        <div className="mx-auto max-w-6xl px-4 py-20">
          <h2 className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">Think in graphs, not tabs</h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-sm text-muted-foreground">
            Everything you learn stays connected on one board you can explore, question and annotate.
          </p>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(({ icon: Icon, title, text, soon }) => (
              <div
                key={title}
                className="group relative rounded-2xl border border-white/[0.07] bg-card/60 p-5 transition-colors hover:border-violet-400/25"
              >
                <span className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/10 text-violet-200">
                  <Icon className="size-5" />
                </span>
                <h3 className="mt-4 flex items-center gap-2 font-medium">
                  {title}
                  {soon && (
                    <span className="rounded-full border border-amber-400/30 px-1.5 py-px text-[10px] font-normal text-amber-200/90">
                      Coming Soon
                    </span>
                  )}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </SiteShell>
  );
}
