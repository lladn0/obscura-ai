"use client";

import dynamic from "next/dynamic";

import { SiteShell } from "@/components/site/site-nav";

// Analytics live in localStorage, so the dashboard renders on the client only.
const StatisticsView = dynamic(() => import("@/components/site/statistics-view"), { ssr: false });

export default function StatisticsPage() {
  return (
    <SiteShell>
      <StatisticsView />
    </SiteShell>
  );
}
