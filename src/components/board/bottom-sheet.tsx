"use client";

import { useRef, useState } from "react";

import { cn } from "@/lib/utils";

const HEIGHT = { peek: "52dvh", full: "92dvh" } as const;

/**
 * Mobile bottom sheet: drag the handle up to expand, down to minimise or
 * dismiss. Content scrolls inside; the canvas stays visible above it.
 */
export function BottomSheet({
  open,
  onClose,
  children,
  label,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  label: string;
}) {
  const [snap, setSnap] = useState<keyof typeof HEIGHT>("peek");
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const end = () => {
    if (start.current === null) return;
    start.current = null;
    setDragging(false);
    if (drag < -50) setSnap("full");
    else if (drag > 70) {
      if (snap === "full") setSnap("peek");
      else onClose();
    }
    setDrag(0);
  };

  return (
    <div
      role="dialog"
      aria-label={label}
      aria-hidden={!open}
      inert={!open}
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 flex flex-col rounded-t-2xl border-t border-white/10 bg-sidebar/95 shadow-[0_-12px_40px_-12px_rgb(0_0_0/0.7)] backdrop-blur-xl",
        !dragging && "transition-[transform,height] duration-300 ease-out motion-reduce:transition-none",
      )}
      style={{
        height: HEIGHT[snap],
        transform: open ? `translateY(${Math.max(drag, snap === "full" ? 0 : -200)}px)` : "translateY(105%)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <div
        className="flex h-6 shrink-0 cursor-grab touch-none items-center justify-center"
        onPointerDown={(e) => {
          start.current = e.clientY;
          setDragging(true);
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => start.current !== null && setDrag(e.clientY - start.current)}
        onPointerUp={end}
        onPointerCancel={end}
        onClick={() => drag === 0 && setSnap((s) => (s === "peek" ? "full" : "peek"))}
        aria-label={snap === "peek" ? "Expand" : "Minimise"}
        role="button"
      >
        <span className="h-1 w-10 rounded-full bg-white/25" />
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
