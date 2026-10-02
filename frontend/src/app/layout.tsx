import type { Metadata } from "next";

import { Nav } from "@/components/nav";

import "./globals.css";

export const metadata: Metadata = {
  title: "HARVEST — Tower K Energy & Comfort Pill",
  description:
    "Governed Intelligence Pills for cooling and comfort. The AI selects an approved pill by ID; numbers are computed in code; humans approve anything that acts. All data is synthetic.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        <Nav />
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
        <footer className="border-t border-border">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-6 py-4 text-xs text-muted-foreground">
            <span>HARVEST — Tower K Energy &amp; Comfort Pill · Tencent Cloud AI CAN DO IT Hackathon SG 2026</span>
            <span className="synthetic-badge">Synthetic data — no real Keppel or personal data</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
