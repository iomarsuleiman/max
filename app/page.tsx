import Link from "next/link";
import { redirect } from "next/navigation";
import { Blocks, Database, FolderTree, LayoutTemplate, Lock, Search, Sparkles, Upload } from "lucide-react";
import { CLOUD } from "@/lib/config";
import { LogoMark } from "@/components/brand/Logo";
import { PublicFrame } from "@/components/marketing/PublicFrame";

const features = [
  { icon: FolderTree, title: "Pages inside pages", body: "Nest, reorder and move pages by dragging the handle in the sidebar. Favorites and recents keep the important ones close." },
  { icon: Blocks, title: "A writing canvas that stays out of the way", body: "Type / for headings, to-dos, toggles, callouts, tables, code, math and diagrams. Drag any block to move it." },
  { icon: Database, title: "Personal databases", body: "Tables, boards, galleries, lists and calendars with filters, sorts, formulas, relations and rollups." },
  { icon: LayoutTemplate, title: "Templates", body: "Start from a video tracker, task board, journal or reading list, or save any page as your own template." },
  { icon: Sparkles, title: "Works with your assistant", body: "Connect ChatGPT, Claude or any MCP client. Everything you can do in Max, your assistant can do too, with your permission." },
  { icon: Upload, title: "Bring everything with you", body: "Import a Notion export or Markdown files. Export all your pages as Markdown or JSON whenever you like." },
  { icon: Search, title: "Find anything", body: "Search titles and content across every page and database row, with ⌘K from anywhere." },
  { icon: Lock, title: "Yours alone", body: "One private workspace per account. No sharing, no tracking of what you write, and a single button to delete it all." },
];

export default async function Landing() {
  if (!CLOUD) redirect("/home");
  const { auth } = await import("@clerk/nextjs/server");
  const { userId } = await auth();
  if (userId) redirect("/home");
  return (
    <PublicFrame>
      <section className="mx-auto flex max-w-3xl flex-col items-center px-4 pb-16 pt-16 text-center sm:pt-24">
        <LogoMark className="mb-8 size-14 text-fg" />
        <h1 className="text-balance text-4xl font-semibold tracking-tight text-fg sm:text-5xl">Your notes, pages and databases. Private by default.</h1>
        <p className="mt-5 max-w-xl text-pretty text-[17px] leading-relaxed text-fg-2">
          Max is a calm workspace for everything you write and track: nested pages, a block editor, personal databases and templates, with an assistant connection when you want one.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/sign-up" className="inline-flex h-10 items-center rounded-lg bg-accent px-5 text-[15px] font-medium text-accent-fg hover:bg-accent-hover">
            Create your workspace
          </Link>
          <Link href="/sign-in" className="inline-flex h-10 items-center rounded-lg px-5 text-[15px] font-medium text-fg shadow-[0_0_0_1px_var(--line-strong)] hover:bg-hover">
            Sign in
          </Link>
        </div>
        <p className="mt-4 text-xs text-fg-3">Free while in early access. Your data stays exportable.</p>
      </section>
      <section className="mx-auto grid max-w-5xl gap-px overflow-hidden rounded-xl bg-line px-0 sm:grid-cols-2 lg:grid-cols-4 mx-4 sm:mx-6 lg:mx-auto">
        {features.map((f) => (
          <div key={f.title} className="bg-canvas p-6">
            <f.icon className="size-5 text-fg-2" aria-hidden />
            <h2 className="mt-4 text-[15px] font-semibold text-fg">{f.title}</h2>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-fg-2">{f.body}</p>
          </div>
        ))}
      </section>
    </PublicFrame>
  );
}
