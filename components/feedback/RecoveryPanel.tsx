import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { WaveRule } from "@/components/brand/WaveRule";

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
    <section
      aria-labelledby="recovery-title"
      className="paper-grain bg-overlay shadow-pop mx-auto my-10 flex min-h-[60dvh] w-[calc(100%-32px)] max-w-xl flex-col justify-center rounded-[32px] px-6 py-10 sm:my-16 sm:px-12 sm:py-14"
    >
      <div className="bg-accent-soft text-accent mb-7 grid size-14 place-items-center rounded-2xl [&>svg]:size-6" aria-hidden="true">
        {icon ?? <ShieldCheck />}
      </div>
      <p className="text-fg-3 mb-3 text-xs font-medium tracking-wide">{eyebrow}</p>
      <h1 id="recovery-title" className="recovery-heading text-fg text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
        {title}
      </h1>
      <div className="text-fg-2 mt-4 text-[15px] leading-7 text-pretty">{body}</div>
      <div className="mt-8 flex flex-wrap items-center gap-2">{children}</div>
      {footnote && <p className="border-line text-fg-3 mt-7 border-t pt-5 text-xs leading-5">{footnote}</p>}
      <WaveRule className="mt-9 opacity-70" />
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
