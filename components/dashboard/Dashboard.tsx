"use client";

import Link from "next/link";
import { ArrowRight, Clock, Database, FileText, LayoutTemplate, PenLine, Plus, Sparkles, Star, Trash2, Upload, Search } from "lucide-react";
import { Button, Skeleton, cn } from "@/components/ui";
import { useOp, prefetchOp } from "@/lib/client/data";
import { greeting, pageTitle, timeAgo } from "@/lib/client/format";
import type { PageSummary } from "@/lib/client/types";
import { useWorkspace } from "@/components/workspace/context";
import { Topbar } from "@/components/workspace/Topbar";
import { PageIcon } from "@/components/workspace/PageIcon";
import { coverClass } from "@/components/page/CoverPicker";

interface Overview {
  counts: { pages: number; databases: number; records: number; words: number; trash: number; templates: number };
  createdThisWeek: number;
  recentlyVisited: PageSummary[];
  recentlyEdited: PageSummary[];
  favorites: PageSummary[];
  activity: { date: string; edited: number }[];
}

/**
 * Home answers one question: "What was I working on, and what do I want to do next?"
 * Continue where you left off first, then quick actions, then a quiet summary.
 */
export function Dashboard() {
  const ws = useWorkspace();
  const q = useOp<Overview>("workspace.overview", {});
  const name = ws.settings?.displayName || (ws.identity.name !== "You" ? ws.identity.name.split(" ")[0] : "");
  const d = q.data;
  return (
    <>
      <Topbar crumbs={[{ href: "/home", title: "Home" }]} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[920px] px-4 pb-20 pt-10 sm:px-10">
          <h1 className="text-center text-[28px] font-semibold tracking-tight text-fg max-sm:text-2xl">
            {greeting()}
            {name ? `, ${name}` : ""}
          </h1>

          <Section icon={<Clock />} title="Jump back in">
            {!d ? (
              <CardRowSkeleton />
            ) : d.recentlyVisited.length ? (
              <div className="scroll-quiet -mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
                {d.recentlyVisited.map((p) => (
                  <RecentCard key={p._id} page={p} />
                ))}
              </div>
            ) : (
              <p className="text-[13.5px] text-fg-2">Pages you open will appear here so you can pick up where you left off.</p>
            )}
          </Section>

          <Section icon={<Sparkles />} title="Start something">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Action icon={<PenLine />} label="New page" hint="⌘⌥N" onClick={() => ws.createPage()} />
              <Action icon={<Database />} label="New database" onClick={() => ws.createPage({ kind: "database" })} />
              <Action icon={<LayoutTemplate />} label="From a template" href="/templates" />
              <Action icon={<Upload />} label="Import from Notion" onClick={() => ws.setImportOpen(true)} />
            </div>
          </Section>

          <div className="mt-10 grid gap-8 md:grid-cols-[1.4fr_1fr]">
            <Section icon={<PenLine />} title="Recently edited" flush>
              {!d ? (
                <ListSkeleton />
              ) : d.recentlyEdited.length ? (
                <ul className="grid">
                  {d.recentlyEdited.map((p) => (
                    <li key={p._id}>
                      <PageLine page={p} meta={`Edited ${timeAgo(p.updatedAt)}`} />
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyHint>Nothing yet. Create a page and start writing.</EmptyHint>
              )}
            </Section>
            <div className="grid content-start gap-8">
              <Section icon={<Star />} title="Favorites" flush>
                {!d ? (
                  <ListSkeleton rows={2} />
                ) : d.favorites.length ? (
                  <ul className="grid">
                    {d.favorites.map((p) => (
                      <li key={p._id}>
                        <PageLine page={p} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyHint>Star pages from their ⋯ menu to keep them here and in the sidebar.</EmptyHint>
                )}
              </Section>
              <Section icon={<FileText />} title="Your workspace" flush>
                {!d ? (
                  <ListSkeleton rows={3} />
                ) : (
                  <>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                      <Stat label="Pages" value={d.counts.pages} />
                      <Stat label="Databases" value={d.counts.databases} detail={`${d.counts.records.toLocaleString("en")} rows`} />
                      <Stat label="Words written" value={d.counts.words} />
                      <Stat label="New this week" value={d.createdThisWeek} />
                    </dl>
                    <Activity days={d.activity} />
                    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-fg-3">
                      {d.counts.templates > 0 && <Link href="/templates" className="hover:text-fg-2">{d.counts.templates} template{d.counts.templates === 1 ? "" : "s"}</Link>}
                      <Link href="/trash" className="inline-flex items-center gap-1 hover:text-fg-2">
                        <Trash2 className="size-3" /> {d.counts.trash} in trash
                      </Link>
                    </div>
                  </>
                )}
              </Section>
            </div>
          </div>
          {q.error && (
            <p className="mt-8 rounded-lg bg-danger-soft px-3 py-2 text-[13px]" role="alert">
              Couldn&apos;t load your overview. {q.error.message}
            </p>
          )}
          <div className="mt-12 flex justify-center">
            <Button variant="ghost" size="sm" icon={<Search className="size-3.5" />} onClick={() => ws.setSearchOpen(true)}>
              Search everything <span className="text-fg-3">⌘K</span>
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

function Section({ icon, title, children, flush }: { icon: React.ReactNode; title: string; children: React.ReactNode; flush?: boolean }) {
  return (
    <section className={cn(!flush && "mt-10")} aria-label={title}>
      <h2 className="mb-3 flex items-center gap-1.5 text-[12.5px] font-medium text-fg-3 [&>svg]:size-3.5">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

function RecentCard({ page }: { page: PageSummary }) {
  const cover = coverClass(page.cover);
  return (
    <Link
      href={`/p/${page._id}`}
      onMouseEnter={() => prefetchOp("pages.get", { id: page._id })}
      className="group relative flex h-[132px] w-[148px] shrink-0 snap-start flex-col overflow-hidden rounded-xl bg-overlay shadow-[0_0_0_1px_var(--line),0_1px_2px_oklch(0_0_0/0.04)] transition-shadow hover:shadow-[0_0_0_1px_var(--line-strong),0_4px_14px_oklch(0_0_0/0.08)]"
    >
      <div className={cn("h-11 shrink-0 bg-surface-2", cover)} />
      <div className="-mt-4 px-3">
        <PageIcon icon={page.icon} kind={page.kind} size={24} className="rounded bg-overlay" />
      </div>
      <div className="flex flex-1 flex-col px-3 pb-2.5 pt-1.5">
        <span className="line-clamp-2 text-[13.5px] font-medium leading-snug text-fg">{pageTitle(page.title)}</span>
        <span className="mt-auto text-[11.5px] text-fg-3">{timeAgo(page.lastOpenedAt)}</span>
      </div>
    </Link>
  );
}

function Action({ icon, label, hint, onClick, href }: { icon: React.ReactNode; label: string; hint?: string; onClick?: () => void; href?: string }) {
  const cls = "flex h-[72px] flex-col justify-between rounded-xl bg-overlay p-3 text-start shadow-[0_0_0_1px_var(--line)] transition-colors hover:bg-surface-2 [&>svg]:size-4 [&>svg]:text-fg-2";
  const body = (
    <>
      {icon}
      <span className="flex items-center justify-between text-[13.5px] font-medium text-fg">
        {label}
        {hint ? <span className="text-[11px] font-normal text-fg-3 max-md:hidden">{hint}</span> : <ArrowRight className="size-3.5 text-fg-3 flip-rtl" />}
      </span>
    </>
  );
  return href ? <Link href={href} className={cls}>{body}</Link> : <button type="button" onClick={onClick} className={cls}>{body}</button>;
}

function PageLine({ page, meta }: { page: PageSummary; meta?: string }) {
  return (
    <Link href={`/p/${page._id}`} onMouseEnter={() => prefetchOp("pages.get", { id: page._id })} className="flex h-9 items-center gap-2.5 rounded-md px-2 text-[14px] text-fg hover:bg-hover">
      <PageIcon icon={page.icon} kind={page.kind} />
      <span className="min-w-0 flex-1 truncate">{pageTitle(page.title)}</span>
      {meta && <span className="shrink-0 text-[12px] text-fg-3">{meta}</span>}
    </Link>
  );
}

function Stat({ label, value, detail }: { label: string; value: number; detail?: string }) {
  return (
    <div>
      <dt className="text-[12px] text-fg-3">{label}</dt>
      <dd className="text-[22px] font-semibold tabular-nums tracking-tight text-fg">
        {value.toLocaleString("en")}
        {detail && <span className="ms-1.5 text-[12px] font-normal text-fg-3">{detail}</span>}
      </dd>
    </div>
  );
}

/** 14-day bar strip: pages by the day they were last edited. Text summary for screen readers. */
function Activity({ days }: { days: { date: string; edited: number }[] }) {
  const max = Math.max(1, ...days.map((d) => d.edited));
  const total = days.reduce((t, d) => t + d.edited, 0);
  return (
    <figure className="mt-4">
      <figcaption className="mb-1.5 flex justify-between text-[11.5px] text-fg-3">
        <span>Last edited, past 14 days</span>
        <span className="tabular-nums">{total} page{total === 1 ? "" : "s"}</span>
      </figcaption>
      <div className="flex h-12 items-end gap-[3px]" role="img" aria-label={`${total} pages were last edited in the past 14 days.`}>
        {days.map((d) => (
          <div key={d.date} title={`${new Date(d.date + "T00:00:00").toLocaleDateString("en", { month: "short", day: "numeric" })}: ${d.edited}`} className="flex-1 rounded-[3px] bg-[var(--chart-1)]" style={{ height: `${Math.max(6, (d.edited / max) * 100)}%`, opacity: d.edited ? 0.85 : 0.18 }} />
        ))}
      </div>
    </figure>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg px-2 py-2 text-[13px] text-fg-3">{children}</p>;
}
function CardRowSkeleton() {
  return (
    <div className="flex gap-3">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-[132px] w-[148px] rounded-xl" />
      ))}
    </div>
  );
}
function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="grid gap-3 px-2 py-1">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={cn("h-4", i % 2 ? "w-1/2" : "w-3/4")} />
      ))}
    </div>
  );
}
export { Plus };
