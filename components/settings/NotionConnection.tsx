"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Database, FileText, Link2, RefreshCw } from "lucide-react";
import { Button, Input, Notice, Select, Spinner } from "@/components/ui";
import { useWorkspace } from "@/components/workspace/context";

interface ConnectionStatus {
  configured: boolean;
  connected: boolean;
  workspace: { id: string; name: string } | null;
  reason?: string;
}
interface Source {
  id: string;
  title: string;
  kind: "page" | "data_source" | "database";
  url: string;
}
interface Preview {
  roots: Source[];
  warnings: string[];
  exact: boolean;
}
interface Job {
  id?: string;
  _id?: string;
  jobId?: string;
  status: string;
  phase?: string;
  created?: number;
  processed?: number;
  total?: number;
  warnings?: unknown[];
  errors?: unknown[];
  error?: string | null;
  failed?: number;
  skipped?: number;
  attachments?: number;
  rootIds?: string[];
  [key: string]: unknown;
}

async function notionRequest<T>(operation: string, args: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  const response = await fetch("/api/notion", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation, args }),
    signal,
  });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(body.error?.message || "Notion could not be reached. Try again.");
  return body.result ?? body;
}

const jobId = (job: Job) => job.jobId || job.id || job._id || "";
const finished = (job: Job) => /^(completed|completed_with_warnings|failed|cancelled)$/.test(job.status);
const statusLabel = (value: string) => value.replace(/_/g, " ");
const warningMessage = (warning: unknown): string =>
  typeof warning === "string"
    ? warning
    : warning && typeof warning === "object" && "message" in warning && typeof warning.message === "string"
      ? warning.message
      : "An item needs review. Download the report for details.";

export function NotionConnection() {
  const ws = useWorkspace();
  const [status, setStatus] = useState<ConnectionStatus>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<"connection" | "choose" | "review" | "job" | "history">("connection");
  const [query, setQuery] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Source[]>([]);
  const [parentId, setParentId] = useState("");
  const [includeDescendants, setIncludeDescendants] = useState(true);
  const [preview, setPreview] = useState<Preview>();
  const [job, setJob] = useState<Job>();
  const [history, setHistory] = useState<Job[]>([]);
  const requestKey = useRef<string | null>(null);

  const loadStatus = useCallback(async (signal?: AbortSignal) => {
    try {
      setStatus(await notionRequest<ConnectionStatus>("status", {}, signal));
    } catch (err) {
      if (!signal?.aborted) setError(err instanceof Error ? err.message : "Could not load connections.");
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void loadStatus(controller.signal);
    return () => controller.abort();
  }, [loadStatus]);

  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const loadSources = async (next = false) => {
    const result = await notionRequest<{ sources: Source[]; nextCursor: string | null }>("sources", { query, ...(next && cursor ? { cursor } : {}) });
    setSources((old) => (next ? [...old, ...result.sources.filter((source) => !old.some((item) => item.id === source.id))] : result.sources));
    setCursor(result.nextCursor);
    setStep("choose");
  };
  const selection = { sourceIds: selected.map((source) => source.id), parentId: parentId || null, includeDescendants };
  const activeId = job ? jobId(job) : "";
  const active = job && !finished(job);
  useEffect(() => {
    if (step !== "job" || !activeId || !active) return;
    const controller = new AbortController();
    let timer: number;
    const refresh = async () => {
      try {
        const latest = await notionRequest<Job>("job", { jobId: activeId }, controller.signal);
        if (!controller.signal.aborted) {
          setJob(latest);
          setError("");
        }
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Progress could not be refreshed. Reopen import history to try again.");
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(refresh, 2000);
      }
    };
    timer = window.setTimeout(refresh, 2000);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [step, activeId, active]);

  const openHistory = () =>
    act(async () => {
      const result = await notionRequest<{ jobs: Job[] }>("history");
      setHistory(result.jobs);
      setStep("history");
    });
  const chooseAgain = () => {
    requestKey.current = null;
    setStep("choose");
  };
  const report = () =>
    act(async () => {
      const result = await notionRequest<Job>("report", { jobId: activeId });
      const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "max-notion-import-report.json";
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    });

  return (
    <section aria-label="Notion connection" className="border-line mb-8 rounded-xl border p-5">
      <div className="flex items-start gap-3">
        <span className="bg-surface-2 grid size-10 shrink-0 place-items-center rounded-lg">
          <Link2 className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">Notion</h3>
          <p className="text-fg-2 mt-1 text-[13px]">Bring your pages and databases into Max as private copies.</p>
        </div>
        {status?.connected && <span className="bg-success-soft text-success rounded-full px-2 py-1 text-xs">Connected</span>}
      </div>
      {error && (
        <div className="mt-4" role="alert">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}
      {!status ? (
        <div className="mt-4">
          <Spinner label="Checking Notion connection" />
          <Button size="sm" onClick={() => loadStatus()}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          {step !== "connection" && (
            <Button size="sm" className="mt-4" icon={<ArrowLeft className="size-3.5" />} onClick={() => setStep("connection")}>
              Connection settings
            </Button>
          )}
          {step === "connection" && (
            <div className="mt-5 space-y-4">
              <p className="text-fg-2 text-[13px]">
                {status.connected
                  ? `Connected to ${status.workspace?.name || "your Notion workspace"}.`
                  : "You choose what to share. Max reads your Notion content and never changes your originals."}
              </p>
              {!status.configured && (
                <Notice>{status.reason || "Direct Notion import needs a configured cloud connection. You can import a Notion export file below."}</Notice>
              )}
              <div className="flex flex-wrap gap-2">
                {status.connected ? (
                  <>
                    <Button variant="primary" pending={busy} onClick={() => act(() => loadSources())}>
                      Import from Notion
                    </Button>
                    <Button size="sm" onClick={() => openHistory()}>
                      View import history
                    </Button>
                    <a className="inline-flex items-center rounded-md px-3 text-[13px] underline underline-offset-4" href="/api/notion/connect">
                      Reconnect
                    </a>
                    <Button
                      size="sm"
                      pending={busy}
                      onClick={() =>
                        act(async () => {
                          const { confirmAction } = await import("@/components/ui");
                          if (
                            !(await confirmAction({
                              title: "Disconnect Notion?",
                              body: "Max will stop reading this workspace. Your imported copies stay in Max.",
                              confirmLabel: "Disconnect",
                            }))
                          )
                            return;
                          await notionRequest("disconnect");
                          await loadStatus();
                        })
                      }
                    >
                      Disconnect
                    </Button>
                  </>
                ) : (
                  status.configured && (
                    <a
                      href="/api/notion/connect"
                      className="bg-accent hover:bg-accent-hover inline-flex h-9 items-center rounded-lg px-4 text-sm font-medium text-white"
                    >
                      Connect Notion
                    </a>
                  )
                )}
                {!status.connected && status.configured && (
                  <Button size="sm" onClick={() => openHistory()}>
                    View import history
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={() => {
                    ws.closeSettings();
                    ws.setImportOpen(true);
                  }}
                >
                  Import from an export file
                </Button>
              </div>
              <details className="text-fg-2 text-[12.5px]">
                <summary className="cursor-pointer">What gets imported?</summary>
                <p className="mt-2">
                  Shared pages, supported blocks, databases and row pages are copied. Unsupported content and attachments appear in the report. Comments,
                  permissions and history are not transferred. Copies do not sync with Notion.
                </p>
              </details>
            </div>
          )}
          {step === "choose" && (
            <div className="mt-5 space-y-4">
              <h4 className="font-medium">Choose what to bring along</h4>
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void act(() => loadSources());
                }}
              >
                <Input
                  aria-label="Search shared Notion pages"
                  placeholder="Search shared pages and databases"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <Button type="submit" pending={busy}>
                  Search
                </Button>
              </form>
              <p className="text-fg-3 text-xs">
                Only content shared with this Notion connection appears here. Selecting a parent includes its descendants when enabled.
              </p>
              <div className="border-line max-h-64 overflow-y-auto rounded-lg border">
                {sources.length ? (
                  sources.map((source) => (
                    <label key={source.id} className="border-line hover:bg-hover flex cursor-pointer items-center gap-3 border-b px-3 py-3 last:border-0">
                      <input
                        type="checkbox"
                        checked={selected.some((item) => item.id === source.id)}
                        onChange={(event) => {
                          requestKey.current = null;
                          setSelected((old) => (event.target.checked ? [...old, source] : old.filter((item) => item.id !== source.id)));
                        }}
                      />
                      {source.kind === "page" ? <FileText className="text-fg-3 size-4 shrink-0" /> : <Database className="text-fg-3 size-4 shrink-0" />}
                      <span className="min-w-0 text-sm break-words" dir="auto">
                        {source.title || "Untitled"}
                      </span>
                    </label>
                  ))
                ) : (
                  <p className="text-fg-2 p-4 text-sm">No shared content found. Reconnect to share more pages, or change your search.</p>
                )}
              </div>
              {cursor && (
                <Button size="sm" pending={busy} onClick={() => act(() => loadSources(true))}>
                  Load more shared pages
                </Button>
              )}
              <label className="grid gap-2 text-sm">
                Destination
                <Select
                  label="Import destination"
                  value={parentId}
                  onChange={(value) => {
                    requestKey.current = null;
                    setParentId(value);
                  }}
                  options={[
                    { value: "", label: "My pages" },
                    ...(ws.tree?.filter((page) => page.kind === "page").map((page) => ({ value: page._id, label: page.title || "Untitled" })) ?? []),
                  ]}
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={includeDescendants}
                  onChange={(event) => {
                    requestKey.current = null;
                    setIncludeDescendants(event.target.checked);
                  }}
                />
                Include descendants and database rows
              </label>
              <div className="flex items-center justify-between gap-3">
                <span className="text-fg-2 text-sm" aria-live="polite">
                  {selected.length} selected
                </span>
                <Button
                  variant="primary"
                  disabled={!selected.length}
                  pending={busy}
                  onClick={() =>
                    act(async () => {
                      setPreview(await notionRequest<Preview>("preview", selection));
                      setStep("review");
                    })
                  }
                >
                  Review import
                </Button>
              </div>
            </div>
          )}
          {step === "review" && preview && (
            <div className="mt-5 space-y-4">
              <h4 className="font-medium">Ready to import a copy?</h4>
              <p className="text-fg-2 text-sm">
                {selected.length} selected roots → {parentId ? ws.byId.get(parentId)?.title || "Selected page" : "My pages"}
              </p>
              <ul className="grid gap-2 text-sm">
                {selected.map((source) => (
                  <li key={source.id} className="flex items-center gap-2">
                    <Check className="text-success size-4" />
                    <span dir="auto">{source.title}</span>
                  </li>
                ))}
              </ul>
              <Notice>
                {preview.exact ? "Preview checked." : "Final counts are discovered during the transfer. This is not a full-workspace estimate."} Your Notion
                originals will not change.
              </Notice>
              {!!preview.warnings.length && (
                <ul aria-label="Import warnings" className="text-fg-2 list-disc space-y-1 ps-5 text-[13px]">
                  {preview.warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2">
                <Button onClick={chooseAgain}>Back</Button>
                <Button
                  variant="primary"
                  pending={busy}
                  onClick={() =>
                    act(async () => {
                      requestKey.current ??= crypto.randomUUID();
                      const result = await notionRequest<{ jobId: string }>("start", { ...selection, idempotencyKey: requestKey.current });
                      setJob(await notionRequest<Job>("job", { jobId: result.jobId }));
                      setStep("job");
                    })
                  }
                >
                  Import a copy
                </Button>
              </div>
            </div>
          )}
          {step === "job" && job && (
            <div className="mt-5 space-y-4" aria-live="polite">
              <h4 className="font-medium">{finished(job) ? "Import report" : "Making room for your ideas"}</h4>
              <p className="text-sm capitalize">
                {statusLabel(job.status)}
                {job.phase ? ` · ${statusLabel(job.phase)}` : ""}
              </p>
              {!finished(job) && (
                <>
                  <Spinner label="Import continues in the background" />
                  <p className="text-fg-2 text-sm">You can close this window. Max keeps importing in the background.</p>
                </>
              )}
              <p className="text-fg-2 text-sm">
                {job.created ?? 0} items created · {job.attachments ?? 0} attachments copied · {job.skipped ?? 0} skipped · {job.failed ?? 0} failed
              </p>
              {job.error && <Notice tone="danger">{job.error}</Notice>}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" pending={busy} onClick={report}>
                  Download report
                </Button>
                {!finished(job) && (
                  <Button
                    size="sm"
                    pending={busy}
                    onClick={() =>
                      act(async () => {
                        await notionRequest("cancel", { jobId: activeId });
                        setJob(await notionRequest<Job>("job", { jobId: activeId }));
                      })
                    }
                  >
                    Cancel import
                  </Button>
                )}
                {/^(failed|cancelled|completed_with_warnings)$/.test(job.status) && (
                  <Button
                    size="sm"
                    icon={<RefreshCw className="size-3.5" />}
                    pending={busy}
                    onClick={() =>
                      act(async () => {
                        await notionRequest("retry", { jobId: activeId });
                        setJob(await notionRequest<Job>("job", { jobId: activeId }));
                      })
                    }
                  >
                    Retry incomplete work
                  </Button>
                )}
                {job.rootIds?.map((id) => (
                  <Button
                    key={id}
                    size="sm"
                    onClick={() => {
                      ws.closeSettings();
                      ws.openPage(id);
                    }}
                  >
                    Open imported page
                  </Button>
                ))}
              </div>
              {!!job.warnings?.length && (
                <details className="text-fg-2 text-[13px]">
                  <summary className="cursor-pointer">Review {job.warnings.length} import warnings</summary>
                  <ul className="mt-2 max-h-64 list-disc space-y-2 overflow-auto ps-5">
                    {job.warnings.map((warning, index) => (
                      <li key={index}>{warningMessage(warning)}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
          {step === "history" && (
            <div className="mt-5 space-y-3">
              <h4 className="font-medium">Import history</h4>
              {history.length ? (
                history.map((entry) => (
                  <button
                    type="button"
                    key={jobId(entry)}
                    className="border-line hover:bg-hover flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-start text-sm"
                    onClick={() =>
                      act(async () => {
                        setJob(await notionRequest<Job>("job", { jobId: jobId(entry) }));
                        setStep("job");
                      })
                    }
                  >
                    <span>Notion import</span>
                    <span className="text-fg-2 capitalize">{statusLabel(entry.status)}</span>
                  </button>
                ))
              ) : (
                <p className="text-fg-2 text-sm">No imports yet. Choose shared pages to import your first copy.</p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
