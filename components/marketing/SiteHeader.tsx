import Link from "next/link";
import { LogoMark } from "@/components/brand/Logo";
import { CLOUD } from "@/lib/config";
import { ThemeToggle } from "./ThemeToggle";

/** The public pages' navigation: full width, with a wavy edge underneath. */
export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href="/" className="flex items-center gap-2 text-fg" aria-label="Max home">
          <LogoMark className="size-6" />
          <span className="text-[16px] font-semibold tracking-tight">Max</span>
        </Link>
        <nav aria-label="Site" className="ms-auto flex items-center gap-1 text-[14px]">
          <Link href="/docs" className="rounded-full px-3 py-1.5 text-fg-2 hover:bg-hover hover:text-fg max-sm:hidden">
            Guides
          </Link>
          <Link href="/connect" className="rounded-full px-3 py-1.5 text-fg-2 hover:bg-hover hover:text-fg max-sm:hidden">
            Assistants
          </Link>
          <Link href="/privacy" className="rounded-full px-3 py-1.5 text-fg-2 hover:bg-hover hover:text-fg max-sm:hidden">
            Privacy
          </Link>
          <ThemeToggle />
          {CLOUD && (
            <Link href="/sign-in" className="rounded-full px-3 py-1.5 font-medium text-fg hover:bg-hover max-sm:hidden">
              Sign in
            </Link>
          )}
          <Link href={CLOUD ? "/sign-up" : "/home"} className="landing-action joy-press ms-1 rounded-full px-4 py-1.5 font-medium">
            Open Max
          </Link>
        </nav>
      </div>
    </header>
  );
}
