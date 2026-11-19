import type { ReactNode } from "react";
import Link from "next/link";
import { LogoMark } from "@/components/brand/Logo";
import { CLOUD, REPO_URL } from "@/lib/config";
import { Fraunces } from "next/font/google";
import { ThemeToggle } from "./ThemeToggle";

const serif = Fraunces({ subsets: ["latin"], display: "swap", weight: ["600"], variable: "--font-landing-serif" });

export function PublicFrame({ children }: { children: ReactNode }) {
  return (
    <div className={`${serif.variable} paper-grain flex min-h-dvh flex-col bg-canvas`}>
      <header className="sticky top-3 z-20 mx-auto mt-3 flex w-[calc(100%-24px)] max-w-5xl items-center gap-3 rounded-full bg-overlay/80 py-2 ps-4 pe-2 shadow-[0_0_0_1px_var(--line),0_8px_24px_-12px_rgb(0_0_0/.2)] backdrop-blur-md">
        <Link href="/" className="flex items-center gap-2 text-fg" aria-label="Max home">
          <LogoMark className="size-6" />
          <span className="text-[15px] font-semibold tracking-tight">Max</span>
        </Link>
        <nav className="ms-auto flex items-center gap-1 text-[13px]">
          <ThemeToggle />
          <Link href="/connect" className="rounded-md px-2.5 py-1.5 text-fg-2 hover:bg-hover hover:text-fg max-sm:hidden">
            Assistants
          </Link>
          <Link href="/privacy" className="rounded-md px-2.5 py-1.5 text-fg-2 hover:bg-hover hover:text-fg max-sm:hidden">
            Privacy
          </Link>
          {CLOUD ? (
            <Link href="/sign-in" className="rounded-md px-2.5 py-1.5 font-medium text-fg hover:bg-hover">
              Sign in
            </Link>
          ) : (
            <Link href="/home" className="rounded-md px-2.5 py-1.5 font-medium text-fg hover:bg-hover">
              Open Max
            </Link>
          )}
        </nav>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-8 text-xs text-fg-3 sm:px-6">
        <span>© {new Date().getFullYear()} Max</span>
        <Link href="/privacy" className="hover:text-fg-2">Privacy</Link>
        <Link href="/connect" className="hover:text-fg-2">Connect an assistant</Link>
        <a href={REPO_URL} className="hover:text-fg-2" rel="noreferrer" target="_blank">Source code (AGPL-3.0)</a>
      </footer>
    </div>
  );
}
