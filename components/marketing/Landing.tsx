import Link from "next/link";
import { ArrowDown, ArrowUpRight, Blocks, Database, FolderTree, Lock } from "lucide-react";
import { CLOUD } from "@/lib/config";
import { PlayfulLogo } from "@/components/brand/PlayfulLogo";
import { PublicFrame } from "./PublicFrame";

const features = [
  {
    icon: FolderTree,
    title: "Ideas find their place.",
    body: "A page for a passing thought. A page inside it for the whole project. Organize as you go, without deciding everything first.",
  },
  {
    icon: Blocks,
    title: "Start with a blank page.",
    body: "Write a little. Add a checklist, a sketch of a plan, a table, or a line of code. Your page grows with the idea.",
  },
  {
    icon: Database,
    title: "Make sense of the moving parts.",
    body: "Turn a reading list, a project, or a collection into a table, board, gallery, list, or calendar. Same information. Your way of seeing it.",
  },
  {
    icon: Lock,
    title: "A space that belongs to you.",
    body: "Private pages. Exportable work. Connect an assistant when you want a hand, and bring copies of your Notion pages along.",
  },
];
export function LandingContent() {
  return (
    <PublicFrame>
      <section className="mx-auto flex min-h-[min(860px,90svh)] max-w-4xl flex-col items-center justify-center px-6 pt-8 pb-20 text-center">
        <PlayfulLogo />
        <h1 className="text-fg max-w-3xl font-serif text-5xl leading-[1.08] tracking-tight text-balance sm:text-7xl">
          A little space.
          <br />
          For your whole world.
        </h1>
        <p className="text-fg-2 mt-6 max-w-lg text-base leading-relaxed text-pretty sm:text-lg">
          Your notes, plans, and things you don’t want to forget. A private workspace that feels like yours.
        </p>
        <Link
          href={CLOUD ? "/sign-up" : "/home"}
          className="joy-press bg-accent text-accent-fg hover:bg-accent-hover mt-8 inline-flex min-h-11 items-center gap-3 rounded-full px-6 py-3 text-sm font-medium"
        >
          {CLOUD ? "Make yourself at home" : "Open your workspace"}
          <ArrowUpRight className="size-4" aria-hidden />
        </Link>
        <a href="#a-place-for-your-ideas" className="text-fg-3 hover:text-fg mt-7 inline-flex items-center gap-2 text-xs">
          Take a look around
          <ArrowDown className="size-3.5" aria-hidden />
        </a>
      </section>
      <section id="a-place-for-your-ideas" className="border-line mx-auto max-w-5xl border-t px-6 py-20 sm:py-28">
        <p className="text-fg-3 text-xs font-medium tracking-[.18em] uppercase">Less setup. More possibility.</p>
        <h2 className="mt-5 max-w-2xl font-serif text-4xl leading-tight tracking-tight sm:text-5xl">
          Good ideas deserve
          <br />
          somewhere to land.
        </h2>
        <div className="mt-16 grid gap-x-20 gap-y-14 sm:grid-cols-2">
          {features.map(({ icon: Icon, title, body }) => (
            <article key={title} className="group">
              <Icon className="text-accent size-6 transition-transform duration-200 motion-safe:group-hover:-rotate-6" aria-hidden />
              <h3 className="mt-5 text-xl font-semibold tracking-tight">{title}</h3>
              <p className="text-fg-2 mt-3 max-w-sm text-[15px] leading-7">{body}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="bg-surface-2 mx-4 rounded-3xl px-6 py-16 text-center sm:mx-auto sm:max-w-5xl sm:py-24">
        <h2 className="font-serif text-4xl tracking-tight">Come as you are.</h2>
        <p className="text-fg-2 mx-auto mt-4 max-w-md text-sm leading-7">
          Bring your pages from Notion, make a card that feels like you, and leave a little room for the next idea.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link
            href={CLOUD ? "/sign-up" : "/home"}
            className="joy-press bg-accent text-accent-fg hover:bg-accent-hover rounded-full px-5 py-3 text-sm font-medium"
          >
            Find your space
          </Link>
          <Link href="/connect" className="border-line-strong hover:bg-hover rounded-full border px-5 py-3 text-sm">
            Connect an assistant
          </Link>
        </div>
      </section>
    </PublicFrame>
  );
}
