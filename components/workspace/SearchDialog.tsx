"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { Dialog as D } from "radix-ui";
import { Clock, CornerDownLeft, Database, FilePlus, LayoutTemplate, Moon, Search, Settings, Sun, X } from "lucide-react";
import { useOp } from "@/lib/client/data";
import { pageTitle, timeAgo } from "@/lib/client/format";
import type { PageSummary } from "@/lib/client/types";
import { cn, Spinner } from "@/components/ui";
import { useWorkspace } from "./context";
import { PageIcon } from "./PageIcon";

type Kind = "all" | "page" | "database" | "record";
interface Result extends PageSummary {
  matchedIn: "title" | "content";
  snippet: string | null;
  breadcrumbs: string[];
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-[2px] bg-warning-soft text-fg">{text.slice(i, i + query.length)}</mark>
      {text.slice(i + query.length)}
    </>
  );
}

export function SearchDialog() {
  const ws = useWorkspace();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [titleOnly, setTitleOnly] = useState(false);
  const debounced = useDebounced(query.trim(), 180);
  const results = useOp<{ results: Result[]; total: number }>("search.query", ws.searchOpen && debounced ? { query: debounced, kind, titleOnly, limit: 30 } : "skip");
  const recents = useOp<{ pages: PageSummary[] }>("pages.recents", ws.searchOpen ? { limit: 8 } : "skip");
  const filtered = kind !== "all" || titleOnly;
  const stale = debounced !== query.trim();

  useEffect(() => {
    if (!ws.searchOpen) {
      setQuery("");
    }
  }, [ws.searchOpen]);

  const go = (href: string) => {
    ws.setSearchOpen(false);
    router.push(href);
  };

  const commands = useMemo(
    () => [
      { id: "new-page", label: "New page", icon: <FilePlus />, run: () => (ws.setSearchOpen(false), ws.createPage()) },
      { id: "new-db", label: "New database", icon: <Database />, run: () => (ws.setSearchOpen(false), ws.createPage({ kind: "database" })) },
      { id: "templates", label: "Browse templates", icon: <LayoutTemplate />, run: () => go("/templates") },
      { id: "settings", label: "Open settings", icon: <Settings />, run: () => (ws.setSearchOpen(false), ws.openSettings("preferences")) },
      {
        id: "theme",
        label: ws.settings?.theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
        icon: ws.settings?.theme === "dark" ? <Sun /> : <Moon />,
        run: () => ws.updateSettings({ theme: ws.settings?.theme === "dark" ? "light" : "dark" }),
      },
    ],
    [ws], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const matchingCommands = query ? commands.filter((c) => c.label.toLowerCase().includes(query.toLowerCase())) : [];

  return (
    <D.Root open={ws.searchOpen} onOpenChange={ws.setSearchOpen}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-[60] bg-[var(--scrim)] [animation:max-fade_120ms_ease]" />
        <D.Content
          aria-describedby={undefined}
          className="fixed start-1/2 top-[12vh] z-[61] w-[min(640px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-xl bg-overlay shadow-dialog outline-none [animation:max-in_150ms_var(--ease)] rtl:translate-x-1/2 max-sm:top-2"
        >
          <D.Title className="sr-only">Search</D.Title>
          <Command shouldFilter={false} label="Search pages" loop>
            <div className="flex items-center gap-2 border-b border-line px-4">
              <Search className="size-4 shrink-0 text-fg-3" />
              <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder="Search pages, databases and rows…"
                className="h-12 min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-fg-3"
              />
              {(results.isLoading || stale) && debounced !== "" && <Spinner />}
              {query && (
                <button type="button" aria-label="Clear search" onClick={() => setQuery("")} className="grid size-6 place-items-center rounded text-fg-3 hover:bg-hover">
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2" role="group" aria-label="Filters">
              {(["all", "page", "database", "record"] as Kind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={kind === k}
                  onClick={() => setKind(k)}
                  className={cn("h-6 rounded-full px-2.5 text-xs text-fg-2 shadow-[0_0_0_1px_var(--line)] hover:bg-hover", kind === k && "bg-fg text-canvas shadow-none hover:bg-fg")}
                >
                  {{ all: "Everything", page: "Pages", database: "Databases", record: "Database rows" }[k]}
                </button>
              ))}
              <button type="button" aria-pressed={titleOnly} onClick={() => setTitleOnly(!titleOnly)} className={cn("h-6 rounded-full px-2.5 text-xs text-fg-2 shadow-[0_0_0_1px_var(--line)] hover:bg-hover", titleOnly && "bg-fg text-canvas shadow-none hover:bg-fg")}>
                Titles only
              </button>
              {filtered && (
                <button type="button" onClick={() => (setKind("all"), setTitleOnly(false))} className="ms-auto h-6 rounded px-2 text-xs text-accent-text hover:bg-hover">
                  Reset filters
                </button>
              )}
            </div>
            <Command.List className="scroll-quiet max-h-[min(440px,60dvh)] overflow-y-auto p-1.5">
              {!debounced ? (
                <>
                  {!!recents.data?.pages.length && (
                    <Command.Group heading="Recent" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-fg-3">
                      {recents.data.pages.map((p) => (
                        <ResultItem key={p._id} value={p._id} onSelect={() => go(`/p/${p._id}`)} icon={<PageIcon icon={p.icon} kind={p.kind} />} title={pageTitle(p.title)} meta={<span className="inline-flex items-center gap-1"><Clock className="size-3" />{timeAgo(p.lastOpenedAt)}</span>} />
                      ))}
                    </Command.Group>
                  )}
                  <Command.Group heading="Actions" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-fg-3">
                    {commands.map((c) => (
                      <ResultItem key={c.id} value={c.id} onSelect={c.run} icon={<span className="text-fg-3 [&>svg]:size-4">{c.icon}</span>} title={c.label} />
                    ))}
                  </Command.Group>
                </>
              ) : (
                <>
                  {results.error && <p className="px-3 py-6 text-center text-[13px] text-danger">{results.error.message}</p>}
                  {results.data && !results.data.results.length && !stale && !matchingCommands.length && (
                    <div className="px-3 py-8 text-center">
                      <p className="text-[13.5px] text-fg">No results for “{debounced}”</p>
                      <p className="mt-1 text-xs text-fg-3">{filtered ? "Try resetting the filters, or" : "Try"} a shorter word, or check the trash.</p>
                      <div className="mt-3 flex justify-center gap-2">
                        {filtered && (
                          <button type="button" className="h-7 rounded-md px-2.5 text-xs shadow-[0_0_0_1px_var(--line-strong)] hover:bg-hover" onClick={() => (setKind("all"), setTitleOnly(false))}>
                            Reset filters
                          </button>
                        )}
                        <button type="button" className="h-7 rounded-md px-2.5 text-xs shadow-[0_0_0_1px_var(--line-strong)] hover:bg-hover" onClick={() => ws.createPage({ title: debounced }).then(() => ws.setSearchOpen(false))}>
                          Create “{debounced}”
                        </button>
                      </div>
                    </div>
                  )}
                  {!!results.data?.results.length && (
                    <Command.Group heading={`${results.data.total} result${results.data.total === 1 ? "" : "s"}`} className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-fg-3">
                      {results.data.results.map((r) => (
                        <ResultItem
                          key={r._id}
                          value={r._id}
                          onSelect={() => go(`/p/${r._id}`)}
                          icon={<PageIcon icon={r.icon} kind={r.kind} />}
                          title={<Highlight text={pageTitle(r.title)} query={debounced} />}
                          meta={r.breadcrumbs.length ? r.breadcrumbs.join(" / ") : undefined}
                          snippet={r.matchedIn === "content" && r.snippet ? <Highlight text={r.snippet} query={debounced} /> : undefined}
                        />
                      ))}
                    </Command.Group>
                  )}
                  {!!matchingCommands.length && (
                    <Command.Group heading="Actions" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-fg-3">
                      {matchingCommands.map((c) => (
                        <ResultItem key={c.id} value={c.id} onSelect={c.run} icon={<span className="text-fg-3 [&>svg]:size-4">{c.icon}</span>} title={c.label} />
                      ))}
                    </Command.Group>
                  )}
                </>
              )}
            </Command.List>
            <div className="flex items-center gap-3 border-t border-line px-4 py-2 text-[11.5px] text-fg-3 max-sm:hidden">
              <span className="inline-flex items-center gap-1">
                <CornerDownLeft className="size-3" /> Open
              </span>
              <span>↑↓ Navigate</span>
              <span>Esc Close</span>
            </div>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

function ResultItem({ value, onSelect, icon, title, meta, snippet }: { value: string; onSelect: () => void; icon: React.ReactNode; title: React.ReactNode; meta?: React.ReactNode; snippet?: React.ReactNode }) {
  return (
    <Command.Item value={value} onSelect={onSelect} className="flex cursor-default items-start gap-2.5 rounded-md px-2 py-1.5 text-[13.5px] text-fg aria-selected:bg-hover">
      <span className="mt-0.5 grid size-5 place-items-center">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate font-medium">{title}</span>
          {meta && <span className="truncate text-xs text-fg-3">{meta}</span>}
        </span>
        {snippet && <span className="mt-0.5 line-clamp-2 block text-xs leading-snug text-fg-2">{snippet}</span>}
      </span>
    </Command.Item>
  );
}
