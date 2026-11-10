import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";

export const recoveryLinkClass =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent";
export const recoverySecondaryClass =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-fg-2 hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent";

/** Shared layout for public connection and recovery states. Never renders raw errors. */
export function RecoveryPanel({
  eyebrow,
  title,
  body,
  icon,
  children,
  footnote,
}: {
  eyebrow: string;
  title: string;
  body: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  footnote?: string;
}) {
  return (
    <section aria-labelledby="recovery-title" className="mx-auto flex min-h-[65dvh] w-full max-w-xl flex-col justify-center px-5 py-12 sm:py-20">
      <div className="bg-accent-soft text-accent mb-7 grid size-14 place-items-center rounded-2xl [&>svg]:size-6" aria-hidden="true">
        {icon ?? <ShieldCheck />}
      </div>
      <p className="text-fg-3 mb-3 text-xs font-medium tracking-wide">{eyebrow}</p>
      <h1 id="recovery-title" className="text-fg text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
        {title}
      </h1>
      <div className="text-fg-2 mt-4 text-[15px] leading-7 text-pretty">{body}</div>
      <div className="mt-8 flex flex-wrap items-center gap-2">{children}</div>
      {footnote && <p className="border-line text-fg-3 mt-7 border-t pt-5 text-xs leading-5">{footnote}</p>}
    </section>
  );
}

export function BackToPages() {
  return (
    <Link href="/home" className={recoverySecondaryClass}>
      <ArrowLeft className="size-4" aria-hidden="true" />
      Go to my pages
    </Link>
  );
}
