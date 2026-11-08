import type { ReactNode } from "react";
import Link from "next/link";
import { LogoMark } from "@/components/brand/Logo";

export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-canvas px-4 py-10">
      <Link href="/" className="flex items-center gap-2 text-fg" aria-label="Max home">
        <LogoMark className="size-7" />
        <span className="text-lg font-semibold tracking-tight">Max</span>
      </Link>
      {children}
      <p className="max-w-sm text-center text-xs leading-relaxed text-fg-3">
        Your workspace is private to your account. Nothing you write is shared or used to train models.{" "}
        <Link href="/privacy" className="underline underline-offset-2">
          How Max handles your data
        </Link>
      </p>
    </main>
  );
}
