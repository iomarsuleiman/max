"use client";

import Link from "next/link";
import { RefreshCw } from "@/components/icons";
import { useOp } from "@/lib/client/data";
import { pageTitle } from "@/lib/client/format";
import { pageHref } from "@/lib/pageUrl";
import { cn } from "@/components/ui";

type Block = { id?: string; type?: string; props?: Record<string, unknown>; content?: unknown; children?: Block[] };

function text(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((c) => (typeof c === "string" ? c : ((c as { text?: string }).text ?? text((c as { content?: unknown }).content)))).join("");
}

/** A calm, read-only rendering of blocks (a synced copy is edited at its source, not here). */
function Blocks({ blocks, depth = 0 }: { blocks: Block[]; depth?: number }) {
  return (
    <>
      {blocks.map((b, i) => {
        const t = text(b.content);
        const key = b.id ?? i;
        const kids = b.children?.length && depth < 6 ? <div className="ps-5"><Blocks blocks={b.children} depth={depth + 1} /></div> : null;
        switch (b.type) {
          case "heading": {
            const level = Number(b.props?.level ?? 1);
            return <div key={key}><p className={cn("font-semibold", level === 1 ? "mt-3 text-[20px]" : level === 2 ? "mt-2 text-[17px]" : "mt-1.5 text-[15px]")}>{t}</p>{kids}</div>;
          }
          case "bulletListItem":
          case "toggleListItem":
            return <div key={key}><p className="flex gap-2"><span aria-hidden>•</span><span>{t}</span></p>{kids}</div>;
          case "numberedListItem":
            return <div key={key}><p>{t}</p>{kids}</div>;
          case "checkListItem":
            return <div key={key}><p className={cn("flex gap-2", b.props?.checked === true && "text-fg-3 line-through")}><span aria-hidden>{b.props?.checked ? "☑" : "☐"}</span><span>{t}</span></p>{kids}</div>;
          case "quote":
          case "callout":
            return <div key={key}><p className="border-s-2 border-line-strong ps-3 text-fg-2">{t}</p>{kids}</div>;
          case "codeBlock":
            return <pre key={key} className="overflow-x-auto rounded-md bg-surface-2 p-2 font-mono text-[12.5px]">{t}</pre>;
          case "divider":
            return <hr key={key} className="my-2 border-line" />;
          case "paragraph":
            return <div key={key}>{t ? <p>{t}</p> : <div className="h-3" />}{kids}</div>;
          default:
            return t ? <p key={key}>{t}</p> : null;
        }
      })}
    </>
  );
}

/** The live content of another page, inside this one. Changes at the source show here at once. */
export function SyncedContent({ pageId }: { pageId: string }) {
  const page = useOp<{ page: { title: string; icon: string | null } }>("pages.get", { id: pageId });
  const doc = useOp<{ blocks: Block[] }>("documents.get", { pageId });
  const title = page.data ? pageTitle(page.data.page.title) : "…";
  return (
    <section aria-label={`Synced from ${title}`} className="rounded-lg px-3 py-2 shadow-[inset_0_0_0_1.5px_color-mix(in_oklch,var(--accent)_45%,transparent)]">
      <p className="mb-1 flex items-center gap-1.5 text-[12px] text-fg-3">
        <RefreshCw className="size-3" aria-hidden />
        {page.error ? (
          "Synced page you can't open, or that was deleted"
        ) : (
          <>
            Synced from <Link href={pageHref(pageId, page.data?.page.title)} className="underline underline-offset-2 hover:text-fg-2">{title}</Link> · edit it there
          </>
        )}
      </p>
      {doc.data ? <div className="grid gap-1 text-[15px] leading-relaxed"><Blocks blocks={doc.data.blocks} /></div> : !page.error && <div className="h-8" />}
    </section>
  );
}
