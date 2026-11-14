"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Rabbit } from "lucide-react";

import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/boards", label: "Boards" },
  { href: "/statistics", label: "Statistics" },
];

export function SiteNav() {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-background/75 backdrop-blur-xl">
      <nav className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 sm:gap-6">
        <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold tracking-tight">
          <span className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-[0_0_24px_-4px_rgb(167_139_250/0.6)]">
            <Rabbit className="size-4 text-white" />
          </span>
          <span className="hidden sm:inline">RabbitHole AI</span>
        </Link>
        <div className="ml-auto flex items-center gap-1">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active(l.href) ? "page" : undefined}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm transition-colors",
                active(l.href)
                  ? "bg-white/[0.08] text-foreground"
                  : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
              )}
            >
              {l.label}
            </Link>
          ))}
        </div>
      </nav>
    </header>
  );
}

/** Page frame for the site pages (not the full-screen research workspace). */
export function SiteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <SiteNav />
      <main className="flex-1">{children}</main>
      <footer className="border-t border-white/[0.06] py-6 text-center text-xs text-muted-foreground">
        RabbitHole AI · research beyond the answer
      </footer>
    </div>
  );
}
