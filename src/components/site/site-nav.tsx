"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, House, LayoutGrid, Rabbit } from "lucide-react";

import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "Home", icon: House },
  { href: "/boards", label: "Boards", icon: LayoutGrid },
  { href: "/statistics", label: "Statistics", icon: BarChart3 },
];

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path.startsWith(href));

export function SiteNav() {
  const path = usePathname();
  const active = (href: string) => isActive(path, href);
  return (
    <header
      className="sticky top-0 z-40 border-b border-white/[0.06] bg-background/75 backdrop-blur-xl"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <nav className="mx-auto flex h-12 max-w-6xl items-center gap-2 px-4 sm:gap-6 md:h-14">
        <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold tracking-tight">
          <span className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-[0_0_24px_-4px_rgb(167_139_250/0.6)]">
            <Rabbit className="size-4 text-white" />
          </span>
          <span>RabbitHole AI</span>
        </Link>
        {/* Phones use the bottom bar instead. */}
        <div className="ml-auto hidden items-center gap-1 md:flex">
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

/** Phones: Home | Boards | Statistics as a bottom tab bar (hidden inside a board). */
export function BottomNav() {
  const path = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.08] bg-background/90 backdrop-blur-xl md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="grid h-14 grid-cols-3">
        {LINKS.map(({ href, label, icon: Icon }) => {
          const active = isActive(path, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 text-[11px] transition-colors",
                active ? "text-violet-200" : "text-muted-foreground",
              )}
            >
              <Icon className={cn("size-5", active && "drop-shadow-[0_0_8px_rgb(167_139_250/0.6)]")} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** Page frame for the site pages (not the full-screen research workspace). */
export function SiteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col overflow-x-hidden bg-background text-foreground">
      <SiteNav />
      <main className="flex-1">{children}</main>
      <footer className="border-t border-white/[0.06] py-6 text-center text-xs text-muted-foreground">
        RabbitHole AI · research beyond the answer
      </footer>
      {/* Room for the bottom tab bar on phones. */}
      <div className="h-[calc(3.5rem+env(safe-area-inset-bottom))] md:hidden" aria-hidden />
      <BottomNav />
    </div>
  );
}
