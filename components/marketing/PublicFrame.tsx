import type { ReactNode } from "react";
import Link from "next/link";
import { REPO_URL } from "@/lib/config";
import { Fraunces } from "next/font/google";
import { SiteHeader } from "./SiteHeader";

const serif = Fraunces({ subsets: ["latin"], display: "swap", weight: ["600"], variable: "--font-landing-serif" });

export function PublicFrame({ children }: { children: ReactNode }) {
  return (
    <div className={`${serif.variable} paper-grain flex min-h-dvh flex-col bg-canvas`}>
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <footer className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-8 text-xs text-fg-3 sm:px-6">
        <span>© {new Date().getFullYear()} Max</span>
        <Link href="/privacy" className="hover:text-fg-2">Privacy</Link>
        <Link href="/docs" className="hover:text-fg-2">Guides</Link>
        <Link href="/connect" className="hover:text-fg-2">Connect an assistant</Link>
        <Link href="/docs/api" className="hover:text-fg-2">API</Link>
        <a href={REPO_URL} className="hover:text-fg-2" rel="noreferrer" target="_blank">Source code (AGPL-3.0)</a>
      </footer>
    </div>
  );
}
