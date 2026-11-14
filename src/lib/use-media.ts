"use client";

import { useSyncExternalStore } from "react";

/** Mobile layout breakpoint (Tailwind `md` is 768px). */
export const MOBILE_QUERY = "(max-width: 767px)";

const subscribe = (query: string) => (onChange: () => void) => {
  const mql = window.matchMedia(query);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
};

export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    subscribe(query),
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export const useIsMobile = () => useMediaQuery(MOBILE_QUERY);

/** Non-hook checks for code outside React render (layout, animation). */
export const isMobileViewport = () => typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches;
export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
