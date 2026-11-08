import type { ReactNode } from "react";
import Link from "next/link";
import { LogoMark } from "@/components/brand/Logo";
import { CLOUD, REPO_URL } from "@/lib/config";

export function PublicFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 text-fg" aria-label="Max home">
          <LogoMark className="size-6" />
          <span className="text-[15px] font-semibold tracking-tight">Max</span>
        </Link>
        <nav className="ms-auto flex items-center gap-1 text-[13px]">
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
