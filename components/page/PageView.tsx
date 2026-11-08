"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, FileQuestion, Link2, Lock, Star } from "lucide-react";
import { toast } from "sonner";
import { Button, EmptyState, IconButton, Notice, Skeleton, cn } from "@/components/ui";
import { useOp } from "@/lib/client/data";
import { pageTitle, timeAgo } from "@/lib/client/format";
import { useAssetResolver, useUploader } from "@/lib/client/upload";
import type { DocumentGetResult, PageGetResult, PageSummary } from "@/lib/client/types";
import { confirmPermanentDelete, notifyError, useWorkspace } from "@/components/workspace/context";
import { Topbar } from "@/components/workspace/Topbar";
import { PageIcon } from "@/components/workspace/PageIcon";
import type { MaxEditorType, PageRef } from "@/components/editor/blocks";
import { EditorCrashBoundary } from "@/components/editor/EditorErrorBoundary";
import { focusEditorStart } from "@/components/editor/focusEnd";
import { DatabaseView } from "@/components/database/DatabaseView";
import { RecordProperties } from "@/components/database/RecordProperties";
import { PageHeader } from "./PageHeader";
import { PageOptions } from "./PageOptions";
import { SaveStatus } from "./SaveStatus";
import { ImageDetailsDialog } from "./ImageDetailsDialog";
import { useDocumentSync } from "./useDocumentSync";
import { requestEditorFocus, takeEditorFocusRequest } from "@/lib/client/editorFocus";

const MaxEditor = dynamic(() => import("@/components/editor/MaxEditor"), {
  ssr: false,
  loading: () => <EditorSkeleton />,
});

function EditorSkeleton() {
  return (
    <div className="grid gap-3 py-2" aria-label="Loading content">
      <Skeleton className="w-11/12" />
      <Skeleton className="w-4/5" />
      <Skeleton className="w-2/3" />
    </div>
  );
}

export function PageView({ pageId }: { pageId: string }) {
  const ws = useWorkspace();
  const router = useRouter();
  const q = useOp<PageGetResult>("pages.get", { id: pageId });
  const page = q.data?.page;
  const isDatabase = page?.kind === "database";
  const doc = useOp<DocumentGetResult>("documents.get", page && !isDatabase ? { pageId } : "skip");

  // Recents.
  const touched = useRef(false);
  useEffect(() => {
    if (!page || touched.current || page.archivedAt) return;
    touched.current = true;
    void ws.call("pages.touch", { id: pageId }).catch(() => undefined);
  }, [page, pageId, ws]);

  useEffect(() => {
    if (page) document.title = `${page.icon ? page.icon + " " : ""}${pageTitle(page.title)} · Max`;
  }, [page]);

  if (q.error) {
    return (
      <>
        <Topbar crumbs={[]} />
        {q.error.code === "NOT_FOUND" ? (
          <EmptyState icon={<FileQuestion className="size-5" />} title="This page doesn't exist" body="It may have been deleted permanently, or the link is wrong." className="mt-16">
            <Button onClick={() => router.push("/home")}>Go to Home</Button>
            <Button variant="ghost" onClick={() => ws.setSearchOpen(true)}>
              Search pages
            </Button>
          </EmptyState>
        ) : (
          <EmptyState title="Couldn't open this page" body={q.error.message} className="mt-16">
            <Button onClick={() => location.reload()}>Try again</Button>
          </EmptyState>
        )}
      </>
    );
  }

  if (!q.data || !page) {
    return (
      <>
        <Topbar crumbs={[]} />
        <div className="mx-auto w-full max-w-[720px] px-4 pt-20 sm:px-12">
          <Skeleton className="mb-6 h-10 w-2/3" />
          <EditorSkeleton />
        </div>
      </>
    );
  }

  const data = q.data;
  const readOnly = !!page.archivedAt || page.locked;
  const widthClass = page.fullWidth ? "max-w-none sm:px-24" : "max-w-[760px]";
  const crumbs = data.breadcrumbs.map((b) => ({ _id: b._id, title: b.title, icon: b.icon, kind: b.kind }));

  return (
    <>
      <Topbar crumbs={crumbs}>
        <PageTopbarActions page={page} saveSlotId={`save-${pageId}`} />
      </Topbar>
      <div className="min-h-0 flex-1 overflow-y-auto" id="page-scroll">
        {page.archivedAt && <TrashBanner data={data} />}
        {page.isTemplate && (
          <div className="bg-accent-soft px-4 py-2 text-center text-[13px] text-fg">
            You&apos;re editing a template. New {page.databaseId ? "rows" : "pages"} made from it copy this content. Use {"{{today}}"} to insert the date.
          </div>
        )}
        <PageHeader page={page} readOnly={readOnly} widthClass={widthClass} onEnter={() => requestEditorFocus(pageId)} />
        <div className={cn("mx-auto w-full px-4 pb-24 sm:px-12", widthClass)}>
          {page.locked && !page.archivedAt && (
            <p className="mb-2 inline-flex items-center gap-1.5 text-[12.5px] text-fg-3">
              <Lock className="size-3.5" /> Locked. Unlock from the ⋯ menu to edit.
            </p>
          )}
          <Backlinks pageId={pageId} />
          {page.databaseId && <RecordProperties record={page} readOnly={readOnly} />}
          {isDatabase ? (
            <div className="-mx-4 sm:-mx-12">
              <DatabaseView database={page} readOnly={readOnly} />
            </div>
          ) : doc.error ? (
            <Notice tone="danger" title="Couldn't load this page's content" action={<Button size="sm" onClick={() => location.reload()}>Reload</Button>}>
              {doc.error.message}
            </Notice>
          ) : !doc.data ? (
            <EditorSkeleton />
          ) : (
            <DocumentEditor key={pageId} pageId={pageId} doc={doc.data} readOnly={readOnly || doc.data.readOnly} smallText={page.smallText} />
          )}
          {!isDatabase && data.children.length > 0 && <ChildPages pages={data.children} />}
        </div>
      </div>
    </>
  );
}

function PageTopbarActions({ page, saveSlotId }: { page: PageGetResult["page"]; saveSlotId: string }) {
  const ws = useWorkspace();
  const fav = !!page.favoriteRank;
  return (
    <>
      <div id={saveSlotId} className="flex items-center" />
      <span className="px-1 text-[12.5px] text-fg-3 max-lg:hidden">Edited {timeAgo(page.updatedAt)}</span>
      {!page.isTemplate && !page.archivedAt && (
        <IconButton label={fav ? "Remove from Favorites" : "Add to Favorites"} size="md" onClick={() => ws.toggleFavorite(page._id, !fav)}>
          <Star className={cn("size-4", fav && "fill-warning text-warning")} />
        </IconButton>
      )}
      <IconButton label="Copy link" size="md" className="max-sm:hidden" onClick={() => ws.copyLink(page._id)}>
        <Link2 className="size-4" />
      </IconButton>
      <PageOptions page={page} />
    </>
  );
}

function TrashBanner({ data }: { data: PageGetResult }) {
  const ws = useWorkspace();
  const router = useRouter();
  const rootId = data.trashedWith?._id ?? data.page._id;
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 bg-danger-soft px-4 py-2 text-[13px] text-fg">
      <span>{data.trashedWith ? `This page is in the trash with “${pageTitle(data.trashedWith.title)}”.` : "This page is in the trash."}</span>
      <Button
        size="xs"
        onClick={() =>
          ws
            .call("pages.restore", { id: rootId })
            .then(() => toast.success("Restored"))
            .catch((e) => notifyError(e))
        }
      >
        Restore page
      </Button>
      <Button
        size="xs"
        variant="ghost"
        className="text-danger hover:bg-danger-soft"
        onClick={async () => {
          if (!(await confirmPermanentDelete(pageTitle(data.trashedWith?.title ?? data.page.title)))) return;
          try {
            await ws.call("pages.deletePermanently", { id: rootId, confirm: true });
            toast.success("Deleted permanently");
            router.push("/home");
          } catch (err) {
            notifyError(err);
          }
        }}
      >
        Delete permanently
      </Button>
    </div>
  );
}

function Backlinks({ pageId }: { pageId: string }) {
  const q = useOp<{ pages: PageSummary[] }>("pages.backlinks", { id: pageId });
  const [open, setOpen] = useState(false);
  const n = q.data?.pages.length ?? 0;
  if (!n) return null;
  return (
    <div className="mb-3 border-b border-line pb-2">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="inline-flex h-6 items-center gap-1.5 rounded px-1 text-[12.5px] text-fg-3 hover:bg-hover hover:text-fg-2">
        <ArrowUpRight className="size-3.5" /> {n} backlink{n === 1 ? "" : "s"}
      </button>
      {open && (
        <ul className="mt-1 grid">
          {q.data!.pages.map((p) => (
            <li key={p._id}>
              <Link href={`/p/${p._id}`} className="flex h-7 items-center gap-2 rounded px-1 text-[13.5px] text-fg-2 hover:bg-hover">
                <PageIcon icon={p.icon} kind={p.kind} /> {pageTitle(p.title)}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ChildPages({ pages }: { pages: PageSummary[] }) {
  return (
    <section className="mt-10 border-t border-line pt-4" aria-label="Pages inside">
      <h2 className="mb-1 text-xs font-medium text-fg-3">Pages inside</h2>
      <ul className="grid">
        {pages.map((p) => (
          <li key={p._id}>
            <Link href={`/p/${p._id}`} className="flex h-8 items-center gap-2 rounded-md px-1.5 text-[14px] text-fg hover:bg-hover">
              <PageIcon icon={p.icon} kind={p.kind} />
              <span className="truncate underline decoration-line-strong underline-offset-[3px]">{pageTitle(p.title)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DocumentEditor({ pageId, doc, readOnly, smallText }: { pageId: string; doc: DocumentGetResult; readOnly: boolean; smallText: boolean }) {
  const ws = useWorkspace();
  const router = useRouter();
  const upload = useUploader();
  const resolve = useAssetResolver();
  const sync = useDocumentSync(pageId, doc.revision);
  const editorRef = useRef<MaxEditorType | null>(null);
  const applyingRemote = useRef(false);
  const [initial] = useState(() => doc.blocks);
  const [editorKey, setEditorKey] = useState(0);
  const [imageTarget, setImageTarget] = useState<{ blockId: string; editor: MaxEditorType } | null>(null);
  const [recovered, setRecovered] = useState<"applied" | "stale" | null>(null);
  const [remoteChanged, setRemoteChanged] = useState(false);

  const pages = useMemo(() => {
    const m = new Map<string, PageRef>();
    for (const p of ws.tree ?? []) m.set(p._id, { title: p.title, icon: p.icon, kind: p.kind });
    return m;
  }, [ws.tree]);

  // Draft recovery: unsent changes from a previous visit on this device.
  const draftChecked = useRef(false);
  const onReady = useCallback(
    (editor: MaxEditorType) => {
      editorRef.current = editor;
      if (takeEditorFocusRequest(pageId)) requestAnimationFrame(() => focusEditorStart(editor));
      if (draftChecked.current) return;
      draftChecked.current = true;
      const draft = sync.readDraft();
      if (!draft) return;
      if (JSON.stringify(draft.blocks) === JSON.stringify(doc.blocks)) return sync.discardDraft();
      if (draft.baseRevision === doc.revision) {
        applyingRemote.current = true;
        editor.replaceBlocks(editor.document, draft.blocks as never);
        applyingRemote.current = false;
        sync.change(draft.blocks);
        setRecovered("applied");
      } else {
        setRecovered("stale");
      }
    },
    [doc.blocks, doc.revision, sync],
  );

  // Remote changes (another tab or a connected assistant).
  useEffect(() => {
    const base = sync.baseRevision();
    if (base === null || doc.revision <= base) return;
    const editor = editorRef.current;
    if (!editor) return;
    // Our own save is still settling; its acknowledgement updates the base revision.
    if (sync.state === "saving" || sync.state === "retrying") return;
    if (sync.hasPending()) {
      setRemoteChanged(true);
      return;
    }
    applyingRemote.current = true;
    editor.replaceBlocks(editor.document, (doc.blocks.length ? doc.blocks : [{ type: "paragraph" }]) as never);
    applyingRemote.current = false;
    sync.adopt(doc.revision);
  }, [doc.revision, doc.blocks, sync, sync.state]);

  useEffect(() => {
    const focus = () => {
      if (editorRef.current && takeEditorFocusRequest(pageId)) focusEditorStart(editorRef.current);
    };
    document.addEventListener("max:focus-editor", focus);
    return () => document.removeEventListener("max:focus-editor", focus);
  }, []);

  const loadLatest = () => {
    const editor = editorRef.current;
    if (editor) {
      applyingRemote.current = true;
      editor.replaceBlocks(editor.document, (doc.blocks.length ? doc.blocks : [{ type: "paragraph" }]) as never);
      applyingRemote.current = false;
    }
    sync.adopt(doc.revision);
    setRemoteChanged(false);
    setRecovered(null);
  };

  const conflict = sync.state === "conflict" || remoteChanged;

  return (
    <div>
      <SaveSlot pageId={pageId}>
        <SaveStatus state={conflict ? "conflict" : sync.state} lastSavedAt={sync.lastSavedAt} error={sync.error} onRetry={() => void sync.flush()} updatedAt={doc.updatedAt} />
      </SaveSlot>
      {recovered === "applied" && (
        <Notice tone="info" className="mb-3" title="Recovered changes you hadn't saved" action={<Button size="xs" variant="ghost" onClick={() => (loadLatest(), toast("Discarded the recovered changes"))}>Discard them</Button>}>
          They were kept on this device and are being saved now.
        </Notice>
      )}
      {recovered === "stale" && (
        <Notice
          tone="warning"
          className="mb-3"
          title="You have unsaved changes from an earlier visit"
          action={
            <>
              <Button size="xs" onClick={() => {
                const draft = sync.readDraft();
                const editor = editorRef.current;
                if (draft && editor) {
                  editor.replaceBlocks(editor.document, draft.blocks as never);
                  sync.adopt(doc.revision);
                  sync.change(draft.blocks);
                }
                setRecovered(null);
              }}>
                Restore my changes
              </Button>
              <Button size="xs" variant="ghost" onClick={() => (sync.discardDraft(), setRecovered(null))}>
                Discard
              </Button>
            </>
          }
        >
          The page was also changed since then. Restoring replaces the current version with yours.
        </Notice>
      )}
      {conflict && (
        <Notice
          tone="warning"
          className="sticky top-2 z-10 mb-3 shadow-pop"
          title="This page changed somewhere else"
          action={
            <>
              <Button size="xs" onClick={loadLatest}>
                Load latest
              </Button>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  setRemoteChanged(false);
                  void sync.keepMine();
                }}
              >
                Keep my version
              </Button>
            </>
          }
        >
          Another tab or a connected assistant saved a newer version. Your edits are safe on this device until you choose.
        </Notice>
      )}
      <EditorCrashBoundary onReopen={() => setEditorKey((k) => k + 1)}>
        <MaxEditor
          key={editorKey}
          initialContent={initial}
          editable={!readOnly}
          onReady={onReady}
          onChange={(blocks) => {
            if (applyingRemote.current) return;
            sync.change(blocks);
          }}
          uploadFile={(file) => upload(file, pageId)}
          resolveFileUrl={resolve}
          onNotice={(m, tone) => (tone === "error" ? toast.error(m) : toast(m))}
          onEditImage={(blockId, editor) => setImageTarget({ blockId, editor })}
          createSubpage={async () => {
            try {
              const { page } = await ws.call<{ page: { _id: string; title: string } }>("pages.create", { parentId: pageId });
              ws.setExpanded(pageId, true);
              return { id: page._id, title: page.title };
            } catch (err) {
              notifyError(err, "Couldn't create the subpage.");
              return null;
            }
          }}
          pages={pages}
          navigate={(id) => router.push(`/p/${id}`)}
          density={ws.settings?.density}
          font={ws.settings?.font}
          smallText={smallText}
          dir={ws.settings?.textDirection}
          spellcheck={ws.settings?.spellcheck}
        />
      </EditorCrashBoundary>
      <ImageDetailsDialog target={imageTarget} onClose={() => setImageTarget(null)} />
    </div>
  );
}

/** Renders the save status into the top bar slot for this page. */
function SaveSlot({ pageId, children }: { pageId: string; children: React.ReactNode }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => setEl(document.getElementById(`save-${pageId}`)), [pageId]);
  if (!el) return null;
  return <PortalTo el={el}>{children}</PortalTo>;
}

function PortalTo({ el, children }: { el: HTMLElement; children: React.ReactNode }) {
  return createPortal(children, el);
}
