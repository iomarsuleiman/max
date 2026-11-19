"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, ChevronRight, FileQuestion, Menu, Search, X } from "lucide-react";
import { EmptyState, Skeleton, cn } from "@/components/ui";
import { LogoMark } from "@/components/brand/Logo";
import { ShareScope, useOp, useSiteNav, useSiteSearch, type SiteNav } from "@/lib/client/data";
import { pageTitle } from "@/lib/client/format";
import { useAssetResolver } from "@/lib/client/upload";
import { pageIdFromParam, pageSlug } from "@/lib/pageUrl";
import type { DocumentGetResult, PageGetResult, PageSummary } from "@/lib/client/types";
import { PageIcon } from "@/components/workspace/PageIcon";
import { CoverView } from "@/components/page/CoverView";
import { PublicDatabase } from "@/components/share/PublicPage";
import { ThemeToggle } from "@/components/marketing/ThemeToggle";
import type { PageRef } from "@/components/editor/blocks";

const MaxEditor = dynamic(() => import("@/components/editor/MaxEditor"), { ssr: false, loading: () => <Skeleton className="h-40" /> });

type NavItem = SiteNav["nav"][number];

/**
 * A published website (Notion Sites / Obsidian Publish style): navigation of every page inside,
 * search, and each page read-only. Works at /site/<slug>/… and on <slug>.<domain>.
 */
export function SiteView({ slug, pageParam }: { slug: string; pageParam: string | null }) {
  const q = useSiteNav(slug);
  const pathname = usePathname();
  const base = pathname?.startsWith("/site/") ? `/site/${slug}` : "";
  const hrefFor = useMemo(() => (id: string, title: string, rootId: string) => (id === rootId ? base || "/" : `${base}/${encodeURI(pageSlug(title))}-${id}`), [base]);
  if (q.error) {
    return (
      <div className="grid min-h-dvh place-items-center bg-canvas text-fg">
        <EmptyState icon={<FileQuestion className="size-5" />} title="This site isn't published" body="The address may be wrong, or the site was taken down." />
      </div>
    );
  }
  if (!q.data) return <div className="min-h-dvh bg-canvas p-10"><Skeleton className="mx-auto h-10 max-w-xl" /></div>;
  const { site, nav } = q.data;
  const pageId = pageParam ? pageIdFromParam(pageParam) : site.rootId;
  return (
    <ShareScope value={{ pageId, linkToken: null, site: slug }}>
      <SiteFrame data={q.data} pageId={pageId} hrefFor={(id, title) => hrefFor(id, title, site.rootId)} nav={nav} />
    </ShareScope>
  );
}

function SiteFrame({ data, pageId, hrefFor, nav }: { data: SiteNav; pageId: string; hrefFor: (id: string, title: string) => string; nav: NavItem[] }) {
  const { site } = data;
  const [menu, setMenu] = useState(false);
  const [searching, setSearching] = useState(false);
  const pathname = usePathname();
  useEffect(() => setMenu(false), [pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (site.search && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearching(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [site.search]);
  // Reading order for previous/next: the navigation, depth first.
  const order = useMemo(() => {
    const kids = new Map<string | null, NavItem[]>();
    for (const n of nav) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n]);
    const out: NavItem[] = [];
    const walk = (id: string | null) => (kids.get(id) ?? []).forEach((n) => (out.push(n), walk(n._id)));
    walk(null);
    return { out, kids };
  }, [nav]);
  const at = order.out.findIndex((n) => n._id === pageId);
  const prev = at > 0 ? order.out[at - 1] : null;
  const next = at >= 0 && at < order.out.length - 1 ? order.out[at + 1] : null;
  return (
    <div className="site min-h-dvh bg-canvas text-fg">
      <header className="site-header">
        <div className="site-header-inner">
          <button type="button" className="grid size-9 place-items-center rounded-full hover:bg-hover lg:hidden" aria-label="Open navigation" aria-expanded={menu} onClick={() => setMenu(true)}>
            <Menu className="size-4" />
          </button>
          <Link href={hrefFor(site.rootId, site.name)} className="flex min-w-0 items-center gap-2">
            <PageIcon icon={site.icon} kind="page" size={22} />
            <span className="truncate text-[16px] font-semibold tracking-tight">{site.name}</span>
          </Link>
          <div className="ms-auto flex items-center gap-1">
            {site.search && (
              <button type="button" onClick={() => setSearching(true)} className="flex h-9 items-center gap-2 rounded-full px-3 text-[13.5px] text-fg-2 shadow-[0_0_0_1px_var(--line)] hover:bg-hover hover:text-fg max-sm:size-9 max-sm:justify-center max-sm:px-0" aria-label="Search this site">
                <Search className="size-4" />
                <span className="max-sm:hidden">Search</span>
                <kbd className="ms-2 font-sans text-[11px] text-fg-3 max-sm:hidden">⌘K</kbd>
              </button>
            )}
            <ThemeToggle />
          </div>
        </div>
      </header>
      <div className="site-body">
        <nav aria-label={`${site.name} pages`} className={cn("site-nav", menu && "is-open")}>
          <div className="flex items-center justify-between px-2 pb-2 lg:hidden">
            <span className="text-[13px] font-medium text-fg-3">Pages</span>
            <button type="button" className="grid size-9 place-items-center rounded-full hover:bg-hover" aria-label="Close navigation" onClick={() => setMenu(false)}>
              <X className="size-4" />
            </button>
          </div>
          <NavTree items={order.kids} parent={null} depth={0} current={pageId} hrefFor={hrefFor} />
          <a href="/" className="site-made">
            <LogoMark className="size-3.5" /> Made with Max
          </a>
        </nav>
        {menu && <button type="button" className="site-scrim lg:hidden" aria-label="Close navigation" onClick={() => setMenu(false)} />}
        <main className="site-main">
          <SitePage pageId={pageId} siteName={site.name} hrefFor={hrefFor} />
          {(prev || next) && (
            <div className="site-pager">
              {prev ? (
                <Link href={hrefFor(prev._id, prev.title)} className="site-pager-link">
                  <span className="text-[12px] text-fg-3"><ArrowLeft className="inline size-3.5" /> Previous</span>
                  <span className="truncate">{pageTitle(prev.title)}</span>
                </Link>
              ) : <span />}
              {next && (
                <Link href={hrefFor(next._id, next.title)} className="site-pager-link text-end">
                  <span className="text-[12px] text-fg-3">Next <ArrowRight className="inline size-3.5" /></span>
                  <span className="truncate">{pageTitle(next.title)}</span>
                </Link>
              )}
            </div>
          )}
        </main>
      </div>
      {searching && <SiteSearch slug={site.slug} hrefFor={hrefFor} onClose={() => setSearching(false)} />}
    </div>
  );
}

function NavTree({ items, parent, depth, current, hrefFor }: { items: Map<string | null, NavItem[]>; parent: string | null; depth: number; current: string; hrefFor: (id: string, title: string) => string }) {
  const list = items.get(parent) ?? [];
  if (!list.length) return null;
  return (
    <ul className="grid gap-px" role={depth === 0 ? "tree" : "group"}>
      {list.map((n) => (
        <NavRow key={n._id} item={n} items={items} depth={depth} current={current} hrefFor={hrefFor} />
      ))}
    </ul>
  );
}

function NavRow({ item, items, depth, current, hrefFor }: { item: NavItem; items: Map<string | null, NavItem[]>; depth: number; current: string; hrefFor: (id: string, title: string) => string }) {
  const kids = items.get(item._id) ?? [];
  const containsCurrent = useMemo(() => {
    const has = (id: string): boolean => id === current || (items.get(id) ?? []).some((k) => has(k._id));
    return has(item._id);
  }, [items, item._id, current]);
  const [open, setOpen] = useState(depth === 0 || containsCurrent);
  useEffect(() => {
    if (containsCurrent) setOpen(true);
  }, [containsCurrent]);
  const active = item._id === current;
  return (
    <li role="treeitem" aria-expanded={kids.length ? open : undefined} aria-selected={active}>
      <div className={cn("site-nav-row", active && "is-active")} style={{ paddingInlineStart: 6 + depth * 14 }}>
        {kids.length > 0 ? (
          <button type="button" className="grid size-5 shrink-0 place-items-center rounded text-fg-3 hover:text-fg" aria-label={open ? `Collapse ${pageTitle(item.title)}` : `Expand ${pageTitle(item.title)}`} onClick={() => setOpen(!open)}>
            <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
          </button>
        ) : (
          <span className="size-5 shrink-0" />
        )}
        <Link href={hrefFor(item._id, item.title)} aria-current={active ? "page" : undefined} className="flex min-w-0 flex-1 items-center gap-2 py-1">
          <PageIcon icon={item.icon} kind={item.kind} size={15} />
          <span className="truncate">{pageTitle(item.title)}</span>
        </Link>
      </div>
      {open && kids.length > 0 && <NavTree items={items} parent={item._id} depth={depth + 1} current={current} hrefFor={hrefFor} />}
    </li>
  );
}

function SitePage({ pageId, siteName, hrefFor }: { pageId: string; siteName: string; hrefFor: (id: string, title: string) => string }) {
  const router = useRouter();
  const q = useOp<PageGetResult>("pages.get", { id: pageId });
  const page = q.data?.page;
  const isDatabase = page?.kind === "database";
  const doc = useOp<DocumentGetResult>("documents.get", page && !isDatabase ? { pageId } : "skip");
  const children = useOp<{ pages: PageSummary[] }>("pages.children", page && !isDatabase ? { parentId: pageId } : "skip");
  const resolve = useAssetResolver();
  const refs = useMemo(() => new Map<string, PageRef>((children.data?.pages ?? []).map((p) => [p._id, { title: p.title, icon: p.icon, kind: p.kind }])), [children.data]);
  useEffect(() => {
    if (page) document.title = page._id === pageId && q.data?.breadcrumbs.length === 1 ? siteName : `${pageTitle(page.title)} · ${siteName}`;
  }, [page, pageId, siteName, q.data]);
  if (q.error) return <EmptyState icon={<FileQuestion className="size-5" />} title="This page isn't part of the site" body="It may have been moved or deleted." className="mt-24" />;
  if (!page) return <div className="mx-auto max-w-[720px] pt-16"><Skeleton className="mb-6 h-10 w-2/3" /><Skeleton className="h-40" /></div>;
  return (
    <article>
      {page.cover && <CoverView cover={page.cover} position={page.coverPosition ?? 50} className="mb-2 h-[26vh] max-h-[240px] min-h-[120px] w-full rounded-2xl" eager />}
      <div className={cn("mx-auto", page.fullWidth ? "" : "max-w-[720px]")}>
        <div className={page.cover ? "-mt-10 ps-4" : "pt-10"}>{page.icon && <PageIcon icon={page.icon} size={64} />}</div>
        <h1 className="mb-4 mt-2 break-words text-[38px] font-bold leading-[1.2] tracking-[-0.01em] max-sm:text-[30px]">{pageTitle(page.title)}</h1>
        {isDatabase ? (
          <PublicDatabase token="" databaseId={pageId} hrefFor={hrefFor} />
        ) : doc.data ? (
          <MaxEditor
            key={pageId}
            initialContent={doc.data.blocks}
            editable={false}
            onChange={() => {}}
            uploadFile={async () => {
              throw new Error("This site is read-only.");
            }}
            resolveFileUrl={resolve}
            onNotice={() => {}}
            onEditImage={() => {}}
            createSubpage={async () => null}
            pages={refs}
            navigate={(id) => router.push(hrefFor(id, refs.get(id)?.title ?? ""))}
            smallText={page.smallText}
          />
        ) : (
          <Skeleton className="h-40" />
        )}
        {!!children.data?.pages.length && (
          <div className="mt-10 grid gap-2 sm:grid-cols-2">
            {children.data.pages.map((p) => (
              <Link key={p._id} href={hrefFor(p._id, p.title)} className="site-card">
                <PageIcon icon={p.icon} kind={p.kind} size={18} />
                <span className="truncate">{pageTitle(p.title)}</span>
                <ArrowRight className="ms-auto size-4 text-fg-3" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function SiteSearch({ slug, hrefFor, onClose }: { slug: string; hrefFor: (id: string, title: string) => string; onClose: () => void }) {
  const search = useSiteSearch();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ _id: string; title: string; icon: string | null; excerpt: string }[]>([]);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    if (q.trim().length < 2) return setResults([]);
    let live = true;
    const t = setTimeout(() => void search(slug, q).then((r) => live && setResults(r.results)).catch(() => undefined), 160);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, slug, search]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-start bg-[var(--scrim)] px-4 pt-[12vh]" onClick={onClose} role="presentation">
      <div role="dialog" aria-modal aria-label="Search this site" className="mx-auto w-full max-w-xl overflow-hidden rounded-2xl bg-overlay shadow-dialog" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <label className="flex items-center gap-2 border-b border-line px-4">
          <Search className="size-4 text-fg-3" aria-hidden />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search pages…" aria-label="Search this site" className="h-12 min-w-0 flex-1 bg-transparent text-[15px] outline-none" />
        </label>
        <ul className="max-h-[50vh] overflow-y-auto p-2">
          {results.map((r) => (
            <li key={r._id}>
              <button type="button" className="grid w-full gap-0.5 rounded-lg px-3 py-2 text-start hover:bg-hover" onClick={() => (router.push(hrefFor(r._id, r.title)), onClose())}>
                <span className="flex items-center gap-2 text-[14px] font-medium"><PageIcon icon={r.icon} kind="page" size={15} />{pageTitle(r.title)}</span>
                {r.excerpt && <span className="line-clamp-2 text-[12.5px] text-fg-3">{r.excerpt}</span>}
              </button>
            </li>
          ))}
          {q.trim().length >= 2 && !results.length && <li className="px-3 py-6 text-center text-[13px] text-fg-3">No pages match “{q}”.</li>}
        </ul>
      </div>
    </div>
  );
}
