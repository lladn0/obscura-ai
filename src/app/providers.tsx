"use client";

import { CopilotKitProvider } from "@copilotkit/react-core/v2";

/**
 * App-wide providers. The research agent lives above every page, so research
 * keeps streaming while the user moves between Boards, Statistics and boards.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return <CopilotKitProvider runtimeUrl="/api/copilotkit">{children}</CopilotKitProvider>;
}
