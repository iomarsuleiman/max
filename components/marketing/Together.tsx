import type { ReactNode } from "react";
import { Bot, Copy, Globe, Users } from "@/components/icons";
import { SquiggleLabel } from "./Squiggle";

/** Hand-drawn style cursor with a name tag, as people see each other in a shared page. */
function Cursor({ name, color }: { name: string; color: string }) {
  return (
    <span className="relative ms-px inline-block h-5 w-[2px] translate-y-1 rounded-full" style={{ background: color }} aria-hidden>
      <span className="absolute bottom-full left-0 mb-0.5 whitespace-nowrap rounded-md rounded-bl-none px-1.5 py-px text-[10.5px] leading-4 font-semibold text-white" style={{ background: color }}>
        {name}
      </span>
    </span>
  );
}

const tile = "together-tile relative overflow-hidden rounded-[28px] p-7 text-fg";
/** A small colored mark is the only color on a tile: calm surfaces, one accent each. */
function Mark({ color, children }: { color: string; children: ReactNode }) {
  return <span className="together-mark" style={{ ["--mark" as string]: color }}>{children}</span>;
}

/** "Better together": what sharing in Max feels like, in a bento of quiet tiles with one color accent each. */
export function Together() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-24 sm:px-8" aria-labelledby="together-title">
      <SquiggleLabel>Sharing</SquiggleLabel>
      <h2 id="together-title" className="landing-headline mt-8 text-center text-[40px] leading-[1.08] font-semibold tracking-[-.03em] text-balance sm:text-6xl">
        Better together.
      </h2>
      <p className="text-fg-2 mx-auto mt-5 max-w-xl text-center text-base leading-relaxed text-balance sm:text-lg">Share a page and work on it at the same time, like you&apos;re in the same room.</p>
      <div className="mt-14 grid gap-4 md:grid-cols-6">
        <div className={`${tile} min-h-[300px] md:col-span-4`}>
          <h3 className="text-2xl font-semibold tracking-tight">Type at the same time.</h3>
          <p className="mt-2 max-w-sm text-[15px] text-fg-2">Everyone edits the same page live and sees each other&apos;s cursors. No refresh, no conflicts.</p>
          <div className="relative mt-8 max-w-md rounded-2xl bg-canvas p-5 ring-1 ring-line text-[15px] leading-9 shadow-sm">
            <p className="font-semibold">Trip to Lisbon ✈️</p>
            <p className="relative">
              Book the tram tour<Cursor name="Lina" color="#c2255c" />
            </p>
            <p className="relative text-fg-2">
              Pastéis de nata at 4<Cursor name="Sam" color="#1971c2" />
            </p>
          </div>
        </div>
        <div className={`${tile} md:col-span-2`}>
          <Mark color="#42a9bc"><Users className="size-5" aria-hidden /></Mark>
          <h3 className="mt-4 text-xl font-semibold tracking-tight">Share like a note, not a file.</h3>
          <p className="mt-2 text-[15px] text-fg-2">Invite by email. Choose who can view, comment, edit or share.</p>
          <div className="mt-5 flex flex-wrap gap-1.5 text-[12px] font-medium">
            {["Full access", "Can edit", "Can comment", "Can view"].map((l) => (
              <span key={l} className="rounded-full bg-hover px-2.5 py-1">{l}</span>
            ))}
          </div>
        </div>
        <div className={`${tile} md:col-span-2`}>
          <Mark color="#a07ad0"><Globe className="size-5" aria-hidden /></Mark>
          <h3 className="mt-4 text-xl font-semibold tracking-tight">Publish in one click.</h3>
          <p className="mt-2 text-[15px] text-fg-2">Turn any page into a link anyone can read, no account needed.</p>
        </div>
        <div className={`${tile} md:col-span-2`}>
          <Mark color="#2fae8f"><Copy className="size-5" aria-hidden /></Mark>
          <h3 className="mt-4 text-xl font-semibold tracking-tight">Make it your own.</h3>
          <p className="mt-2 text-[15px] text-fg-2">Like a page someone shared? Duplicate it into your workspace.</p>
        </div>
        <div className={`${tile} md:col-span-2`}>
          <Mark color="#6f8fab"><Bot className="size-5" aria-hidden /></Mark>
          <h3 className="mt-4 text-xl font-semibold tracking-tight">Bring your assistant.</h3>
          <p className="mt-2 text-[15px] text-fg-2">Claude and ChatGPT can read, write and share pages with your permission.</p>
        </div>
      </div>
    </section>
  );
}
