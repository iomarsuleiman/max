"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { ClipboardCheck, FilePenLine, Megaphone, ShieldCheck } from "lucide-react";
import { useWorkspaces } from "@/components/workspace/Workspaces";
import { useOrgDetails } from "@/lib/client/organizations";
import { toast } from "sonner";
import { Button, Dialog, Field, Menu, MenuContent, MenuItem, MenuTrigger, Textarea, cn } from "@/components/ui";
import { useOp } from "@/lib/client/data";
import { timeAgo } from "@/lib/client/format";
import { useAssetResolver, useUploader } from "@/lib/client/upload";
import { notifyError, useWorkspace } from "@/components/workspace/context";
import { MemberPicker } from "@/components/org/PageAccess";
import { can, usePageAccess } from "@/components/share/access";
import { blockLines, diffLines } from "@/lib/client/diff";

const MaxEditor = dynamic(() => import("@/components/editor/MaxEditor"), { ssr: false });

interface Decision {
  by: string;
  byName: string | null;
  decision: "approved" | "changes_requested" | "cancelled";
  note: string;
  at: number;
}
interface Review {
  _id: string;
  pageId: string;
  kind: "review" | "suggestion";
  requestedBy: string;
  requestedByName: string | null;
  reviewers: string[];
  message: string;
  status: "pending" | "approved" | "changes_requested" | "cancelled";
  decisions: Decision[];
  createdAt: number;
}

/** The topbar's Review menu: ask for a review, or suggest edits instead of changing the page. */
export function ReviewMenu({ pageId }: { pageId: string }) {
  const access = usePageAccess();
  const [dialog, setDialog] = useState<"request" | "suggest" | "announce" | null>(null);
  const current = useWorkspaces().current;
  const orgAdmin = current?.kind === "organization" && (current.role === "owner" || current.role === "admin");
  if (!can(access, "comment")) return null;
  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <button type="button" className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[13.5px] text-fg-2 hover:bg-hover hover:text-fg" aria-label="Review">
            <ClipboardCheck className="size-4" aria-hidden />
            <span className="max-sm:hidden">Review</span>
          </button>
        </MenuTrigger>
        <MenuContent align="end">
          {can(access, "edit") && (
            <MenuItem icon={<ShieldCheck />} onSelect={() => setDialog("request")}>
              Request a review…
            </MenuItem>
          )}
          <MenuItem icon={<FilePenLine />} onSelect={() => setDialog("suggest")}>
            Suggest edits…
          </MenuItem>
          {orgAdmin && (
            <MenuItem icon={<Megaphone />} onSelect={() => setDialog("announce")}>
              Announce to the organization…
            </MenuItem>
          )}
        </MenuContent>
      </Menu>
      {dialog === "request" && <RequestReview pageId={pageId} onClose={() => setDialog(null)} />}
      {dialog === "suggest" && <SuggestEdits pageId={pageId} onClose={() => setDialog(null)} />}
      {dialog === "announce" && <Announce pageId={pageId} orgId={current?.id ?? null} onClose={() => setDialog(null)} />}
    </>
  );
}

function RequestReview({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const ws = useWorkspace();
  const [reviewers, setReviewers] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Request a review" description="Everyone you pick must approve. They're notified, and every decision stays in the page's review history.">
      <div className="grid gap-3 px-5 pb-5 pt-2">
        <Field label="Reviewers" htmlFor="reviewers">
          <MemberPicker value={reviewers} onChange={setReviewers} />
        </Field>
        <Field label="Message (optional)" htmlFor="review-message">
          <Textarea id="review-message" rows={2} value={message} maxLength={1000} onChange={(e) => setMessage(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            pending={busy}
            disabled={!reviewers.length}
            onClick={async () => {
              setBusy(true);
              try {
                await ws.call("approvals.request", { pageId, reviewers, message });
                toast.success("Review requested");
                onClose();
              } catch (err) {
                notifyError(err);
                setBusy(false);
              }
            }}
          >
            Request review
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** Edit a copy of the page in the real editor; the page itself doesn't change until accepted. */
function SuggestEdits({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const ws = useWorkspace();
  const doc = useOp<{ blocks: unknown[]; revision: number }>("documents.get", { pageId });
  const upload = useUploader();
  const resolve = useAssetResolver();
  const [blocks, setBlocks] = useState<unknown[] | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Suggest edits" description="Change the copy below. The page stays as it is until a reviewer accepts your suggestion." size="lg">
      <div className="grid gap-3 px-5 pb-5 pt-2">
        <div className="max-h-[55vh] min-h-48 overflow-y-auto rounded-lg py-3 shadow-[0_0_0_1px_var(--line)]">
          {doc.data ? (
            <MaxEditor
              initialContent={doc.data.blocks}
              editable
              onChange={setBlocks}
              uploadFile={(file) => upload(file, pageId)}
              resolveFileUrl={resolve}
              onNotice={(m, tone) => (tone === "error" ? toast.error(m) : toast(m))}
              onEditImage={() => undefined}
              createSubpage={async () => null}
              pages={new Map()}
              navigate={() => undefined}
            />
          ) : (
            <p className="px-4 text-[13px] text-fg-3">Loading the page…</p>
          )}
        </div>
        <Field label="What did you change? (optional)" htmlFor="suggest-message">
          <Textarea id="suggest-message" rows={2} value={message} maxLength={1000} onChange={(e) => setMessage(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            pending={busy}
            disabled={!blocks || !doc.data}
            onClick={async () => {
              setBusy(true);
              try {
                await ws.call("approvals.suggest", { pageId, blocks, baseRevision: doc.data!.revision, message });
                toast.success("Suggestion sent for review");
                onClose();
              } catch (err) {
                notifyError(err);
                setBusy(false);
              }
            }}
          >
            Send suggestion
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** Open reviews on this page, above its content, with the reviewer's actions. */
export function ReviewBanner({ pageId }: { pageId: string }) {
  const access = usePageAccess();
  const q = useOp<{ approvals: Review[] }>("approvals.list", { pageId });
  const [open, setOpen] = useState<string | null>(null);
  const me = access.you;
  const list = q.data?.approvals ?? [];
  if (!list.length) return null;
  return (
    <div className="grid gap-1.5 px-4 pt-3 sm:px-12">
      {list.map((r) => {
        const approved = new Set(r.decisions.filter((d) => d.decision === "approved").map((d) => d.by));
        const mine = !!me && r.reviewers.includes(me) && !approved.has(me);
        return (
          <div key={r._id} role="status" className={cn("mx-auto flex w-full max-w-[720px] flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-[13px] shadow-[0_0_0_1px_var(--line)]", mine ? "bg-accent-soft" : "bg-surface")}>
            {r.kind === "suggestion" ? <FilePenLine className="size-4 shrink-0 text-fg-3" aria-hidden /> : <ShieldCheck className="size-4 shrink-0 text-fg-3" aria-hidden />}
            <span className="min-w-0 flex-1">
              <b className="font-medium">{r.requestedByName ?? "Someone"}</b> {r.kind === "suggestion" ? "suggested edits" : "asked for a review"} · {timeAgo(r.createdAt)}
              {r.reviewers.length > 1 && r.kind === "review" ? ` · ${approved.size}/${r.reviewers.length} approved` : ""}
              {r.message ? <span className="block truncate text-fg-3">“{r.message}”</span> : null}
            </span>
            <Button size="xs" variant={mine ? "primary" : "ghost"} onClick={() => setOpen(r._id)}>
              {mine ? (r.kind === "suggestion" ? "Review changes" : "Review") : "Details"}
            </Button>
          </div>
        );
      })}
      {open && <ReviewDialog id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ReviewDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const ws = useWorkspace();
  const access = usePageAccess();
  const q = useOp<{ approval: Review; current: unknown[]; currentRevision: number; proposed: unknown[] | null }>("approvals.get", { id });
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const a = q.data?.approval;
  const diff = useMemo(() => (q.data?.proposed ? diffLines(blockLines(q.data.current), blockLines(q.data.proposed)) : null), [q.data]);
  if (!a) return null;
  const me = access.you;
  const isReviewer = !!me && a.reviewers.includes(me) && a.requestedBy !== me;
  const decide = async (decision: "approved" | "changes_requested" | "cancelled", force = false) => {
    setBusy(true);
    try {
      const r = await ws.call<{ status: string }>("approvals.decide", { id, decision, note, force });
      toast.success(decision === "cancelled" ? "Cancelled" : r.status === "approved" ? (a.kind === "suggestion" ? "Suggestion accepted. It's in the page's history." : "Approved") : decision === "approved" ? "Approved. Waiting for the other reviewers." : "Changes requested");
      onClose();
    } catch (err) {
      if ((err as { code?: string }).code === "CONFLICT") setStale(true);
      notifyError(err);
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={a.kind === "suggestion" ? "Suggested edits" : "Review request"} description={`From ${a.requestedByName ?? "someone"} · ${timeAgo(a.createdAt)}${a.message ? ` · “${a.message}”` : ""}`} size="lg">
      <div className="grid gap-3 px-5 pb-5 pt-2 text-[13px]">
        {diff && (
          <div className="max-h-[45vh] overflow-y-auto rounded-lg py-2 font-mono text-[12.5px] shadow-[0_0_0_1px_var(--line)]" aria-label="Changes">
            {diff.every((d) => d.type === "same") ? (
              <p className="px-3 py-2 font-sans text-fg-3">No text changes (formatting or files may differ).</p>
            ) : (
              diff.map((d, i) =>
                d.type === "same" ? (
                  <p key={i} className="truncate px-3 text-fg-3">{d.text || " "}</p>
                ) : (
                  <p key={i} className={cn("whitespace-pre-wrap px-3", d.type === "add" ? "bg-success-soft" : "bg-danger-soft line-through decoration-danger/60")}>
                    <span className="sr-only">{d.type === "add" ? "Added: " : "Removed: "}</span>
                    {d.text || " "}
                  </p>
                ),
              )
            )}
          </div>
        )}
        {a.decisions.length > 0 && (
          <ul aria-label="Review history" className="grid gap-1">
            {a.decisions.map((d, i) => (
              <li key={i} className="text-fg-2">
                <b className="font-medium text-fg">{d.byName ?? "Someone"}</b> {d.decision === "approved" ? "approved" : d.decision === "cancelled" ? "cancelled" : "requested changes"} · {timeAgo(d.at)}
                {d.note && <span className="block text-fg-3">“{d.note}”</span>}
              </li>
            ))}
          </ul>
        )}
        {a.status === "pending" && (isReviewer || a.requestedBy === me) && (
          <>
            <Textarea rows={2} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="Add a note (optional)" aria-label="Note" />
            <div className="flex flex-wrap justify-end gap-2">
              {a.requestedBy === me && <Button variant="ghost" onClick={() => decide("cancelled")}>Cancel request</Button>}
              {isReviewer && (
                <>
                  <Button variant="ghost" pending={busy} onClick={() => decide("changes_requested")}>{a.kind === "suggestion" ? "Decline" : "Request changes"}</Button>
                  {stale ? (
                    <Button variant="danger" pending={busy} onClick={() => decide("approved", true)}>Accept anyway</Button>
                  ) : (
                    <Button variant="primary" pending={busy} onClick={() => decide("approved")}>{a.kind === "suggestion" ? "Accept changes" : "Approve"}</Button>
                  )}
                </>
              )}
            </div>
          </>
        )}
        {a.status !== "pending" && <p className="text-fg-3">This review is {a.status.replace("_", " ")}.</p>}
      </div>
    </Dialog>
  );
}

/** Admins tell everyone (or chosen teams) about a page; only people who can open it hear about it. */
function Announce({ pageId, orgId, onClose }: { pageId: string; orgId: string | null; onClose: () => void }) {
  const ws = useWorkspace();
  const teams = useOrgDetails(orgId).data?.teams.filter((t) => !t.archivedAt) ?? [];
  const [message, setMessage] = useState("");
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Announce this page" description="It lands in people's inbox with your message. People who can't open the page aren't told.">
      <div className="grid gap-3 px-5 pb-5 pt-2 text-[13px]">
        <Textarea rows={3} autoFocus value={message} maxLength={500} onChange={(e) => setMessage(e.target.value)} placeholder="What should people know?" aria-label="Message" />
        {teams.length > 0 && (
          <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
            <legend className="mb-1 font-medium">Only these teams (optional)</legend>
            {teams.map((t) => (
              <label key={t.id} className="flex items-center gap-1.5">
                <input type="checkbox" checked={teamIds.includes(t.id)} onChange={(e) => setTeamIds((ids) => (e.target.checked ? [...ids, t.id] : ids.filter((x) => x !== t.id)))} /> {t.name}
              </label>
            ))}
          </fieldset>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            pending={busy}
            disabled={!message.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await ws.call<{ sent: number }>("announcements.send", { pageId, message, ...(teamIds.length ? { teamIds } : {}) });
                toast.success(`Announced to ${r.sent} ${r.sent === 1 ? "person" : "people"}`);
                onClose();
              } catch (err) {
                notifyError(err);
                setBusy(false);
              }
            }}
          >
            Announce
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
