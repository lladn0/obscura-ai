import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "@xyflow/react/dist/style.css";
import "./globals.css";
import { Suspense } from "react";
import { Providers } from "./providers";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RabbitHole AI",
  description: "Turn any research question into an interactive knowledge board.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Content may extend under the notch/home indicator; pages pad with safe-area insets.
  viewportFit: "cover",
  themeColor: "#0b0a10",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* Pages read the clock and localStorage on the client; nothing here is prerendered. */}
        <Suspense fallback={<div className="min-h-dvh bg-background" />}>
          <Providers>{children}</Providers>
        </Suspense>
      </body>
    </html>
  );
}
