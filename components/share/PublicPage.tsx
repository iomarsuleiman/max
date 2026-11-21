"use client";

import { useMemo, useState } from "react";
import { ThemeToggle } from "@/components/marketing/ThemeToggle";
import { ReportDialog } from "@/components/admin/ReportDialog";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, FileQuestion } from "@/components/icons";
import { EmptyState, Skeleton } from "@/components/ui";
import { LogoMark } from "@/components/brand/Logo";
import { ShareScope, useOp } from "@/lib/client/data";
import { pageTitle } from "@/lib/client/format";
import { useAssetResolver } from "@/lib/client/upload";
import { pageHref, publicHref } from "@/lib/pageUrl";
import type { DocumentGetResult, PageGetResult, PageSummary, RecordView } from "@/lib/client/types";
import type { PropertyDef } from "@/lib/domain/types";
import { PageIcon } from "@/components/workspace/PageIcon";
import { CoverView } from "@/components/page/CoverView";
import type { PageRef } from "@/components/editor/blocks";

const MaxEditor = dynamic(() => import("@/components/editor/MaxEditor"), { ssr: false, loading: () => <Skeleton className="h-40" /> });


/**
 * A page published to the web, read by anyone with the link and no account: content, sub-pages
 * and databases, read-only. Everything is fetched through the link (lib/domain/sharing.ts).
 */
export function PublicPage({ token, pageId }: { token: string; pageId: string }) {
  const scope = useMemo(() => ({ pageId, linkToken: token, anonymous: true }), [pageId, token]);
  return (
    <ShareScope value={scope}>
      <PublicPageBody token={token} pageId={pageId} />
    </ShareScope>
  );
}

function PublicPageBody({ token, pageId }: { token: string; pageId: string }) {
  const router = useRouter();
  const q = useOp<PageGetResult>("pages.get", { id: pageId });
  const page = q.data?.page;
  const isDatabase = page?.kind === "database";
  const doc = useOp<DocumentGetResult>("documents.get", page && !isDatabase ? { pageId } : "skip");
  const children = useOp<{ pages: PageSummary[] }>("pages.children", page && !isDatabase ? { parentId: pageId } : "skip");
  const resolve = useAssetResolver();
  const refs = useMemo(() => new Map<string, PageRef>((children.data?.pages ?? []).map((p) => [p._id, { title: p.title, icon: p.icon, kind: p.kind }])), [children.data]);

  if (q.error) {
    return (
      <Frame>
        <EmptyState icon={<FileQuestion className="size-5" />} title="This page isn't published" body="The link may have been turned off, or the page was moved or deleted." className="mt-24" />
      </Frame>
    );
  }
  if (!page || !q.data) {
    return (
      <Frame>
        <div className="mx-auto max-w-[720px] px-4 pt-24 sm:px-12">
          <Skeleton className="mb-6 h-10 w-2/3" />
          <Skeleton className="h-40" />
        </div>
      </Frame>
    );
  }
  const crumbs = q.data.breadcrumbs;
  return (
    <Frame
      crumbs={crumbs.map((c) => ({ title: c.title, icon: c.icon, kind: c.kind, href: publicHref(token, c._id, c.title) }))}
      // Duplicating needs an account: this opens the page in Max (signing in first) and copies it.
      duplicateHref={`${pageHref(page._id, page.title)}?share=${token}&duplicate=1`}
    >
      {page.cover && <CoverView cover={page.cover} position={page.coverPosition ?? 50} className="h-[30vh] max-h-[280px] min-h-[120px] w-full" eager />}
      <article className={page.fullWidth ? "mx-auto px-4 sm:px-24" : "mx-auto max-w-[760px] px-4 sm:px-12"}>
        <div className={page.cover ? "-mt-10" : "pt-16"}>{page.icon && <PageIcon icon={page.icon} size={72} />}</div>
        <h1 className="mb-4 mt-2 break-words text-[40px] font-bold leading-[1.2] tracking-[-0.01em] text-fg max-sm:text-[32px]">{pageTitle(page.title)}</h1>
        {isDatabase ? (
          <PublicDatabase token={token} databaseId={pageId} />
        ) : doc.data ? (
          <MaxEditor
            initialContent={doc.data.blocks}
            editable={false}
            onChange={() => {}}
            uploadFile={async () => {
              throw new Error("Published pages are read-only.");
            }}
            resolveFileUrl={resolve}
            onNotice={() => {}}
            onEditImage={() => {}}
            createSubpage={async () => null}
            pages={refs}
            navigate={(id) => router.push(publicHref(token, id, refs.get(id)?.title))}
            smallText={page.smallText}
          />
        ) : (
          <Skeleton className="h-40" />
        )}
        {!!children.data?.pages.length && (
          <nav aria-label="Pages inside" className="mt-10 border-t border-line pt-4">
            <h2 className="mb-2 text-[13px] font-medium text-fg-3">Pages inside</h2>
            <ul className="grid gap-0.5">
              {children.data.pages.map((p) => (
                <li key={p._id}>
                  <Link href={publicHref(token, p._id, p.title)} className="flex h-8 items-center gap-2 rounded-md px-1.5 text-[14px] text-fg hover:bg-hover">
                    <PageIcon icon={p.icon} kind={p.kind} />
                    <span className="truncate">{pageTitle(p.title)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
        <div className="h-24" />
      </article>
    </Frame>
  );
}

export function PublicDatabase({ token, databaseId, hrefFor }: { token: string; databaseId: string; hrefFor?: (id: string, title: string) => string }) {
  const meta = useOp<{ properties: PropertyDef[] }>("databases.get", { databaseId });
  const rows = useOp<{ records: RecordView[]; total: number }>("databases.query", { databaseId, limit: 200 });
  if (!meta.data || !rows.data) return <Skeleton className="h-40" />;
  const props = meta.data.properties.filter((p) => p.type !== "title").slice(0, 5);
  const show = (v: RecordView["values"][string]) => (v === null || v === undefined ? "" : Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? "✓" : "") : String(v));
  return (
    <div className="overflow-x-auto rounded-md shadow-[0_0_0_1px_var(--line)]">
      <table className="w-full min-w-[480px] border-collapse text-[14px]">
        <thead>
          <tr className="text-start text-[12.5px] text-fg-3">
            <th className="border-b border-line px-3 py-2 text-start font-medium">Name</th>
            {props.map((p) => (
              <th key={p.id} className="border-b border-line px-3 py-2 text-start font-medium">{p.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.data.records.map((r) => (
            <tr key={r._id} className="hover:bg-hover">
              <td className="border-b border-line px-3 py-2">
                <Link href={hrefFor ? hrefFor(r._id, r.title) : publicHref(token, r._id, r.title)} className="flex items-center gap-1.5 font-medium text-fg">
                  <PageIcon icon={r.icon} kind="page" size={15} />
                  {pageTitle(r.title)}
                </Link>
              </td>
              {props.map((p) => (
                <td key={p.id} className="border-b border-line px-3 py-2 text-fg-2">{show(r.values[p.id])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.data.total > rows.data.records.length && <p className="px-3 py-2 text-[12.5px] text-fg-3">Showing the first {rows.data.records.length} of {rows.data.total}.</p>}
    </div>
  );
}

function Frame({ crumbs = [], duplicateHref, children }: { crumbs?: { title: string; icon: string | null; kind: string; href: string }[]; duplicateHref?: string; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas text-fg">
      <header className="sticky top-0 z-10 flex h-12 items-center gap-2 bg-canvas px-3 sm:px-4">
        <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
          <ol className="flex min-w-0 items-center gap-1 text-[13.5px] text-fg-2">
            {crumbs.map((c, i) => (
              <li key={c.href} className="flex min-w-0 items-center gap-1">
                {i > 0 && <span className="text-fg-3">/</span>}
                <Link href={c.href} className="flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 hover:bg-hover">
                  <PageIcon icon={c.icon} kind={c.kind} size={15} />
                  <span className="truncate">{pageTitle(c.title)}</span>
                </Link>
              </li>
            ))}
          </ol>
        </nav>
        {duplicateHref && (
          <Link href={duplicateHref} className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-fg-2 hover:bg-hover hover:text-fg">
            <Copy className="size-4" /> Duplicate
          </Link>
        )}
        <ReportLink />
        <Link href="/" className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] text-fg-2 hover:bg-hover hover:text-fg max-sm:hidden">
          <LogoMark className="size-4" /> Made with Max
        </Link>
        <ThemeToggle />
      </header>
      <main>{children}</main>
    </div>
  );
}

function ReportLink() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="shrink-0 rounded-md px-2 py-1 text-[12.5px] text-fg-3 hover:bg-hover hover:text-fg">
        Report
      </button>
      {open && <ReportDialog open={open} onOpenChange={setOpen} defaultKind="content" />}
    </>
  );
}
