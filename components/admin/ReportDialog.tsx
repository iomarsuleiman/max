"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button, Dialog, Segmented } from "@/components/ui";
import { useReport, type ReportInput } from "@/lib/client/admin";
import { notifyError } from "@/components/workspace/context";

/**
 * "Report a problem" (in the app) and "Report this page" (on published pages and sites): a short
 * form that lands in the admins' inbox.
 */
export function ReportDialog({ open, onOpenChange, context, defaultKind = "bug" }: { open: boolean; onOpenChange: (o: boolean) => void; context?: Omit<ReportInput, "kind" | "message">; defaultKind?: ReportInput["kind"] }) {
  const report = useReport();
  const [kind, setKind] = useState<ReportInput["kind"]>(defaultKind);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await report({ kind, message, url: typeof window === "undefined" ? null : window.location.href, ...context });
      toast.success("Thanks. We'll look into it.");
      setMessage("");
      onOpenChange(false);
    } catch (err) {
      notifyError(err, "Couldn't send the report.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={context?.siteSlug || defaultKind === "content" ? "Report this page" : "Report a problem"} description="It goes straight to the people who run Max.">
      <form onSubmit={submit} className="grid gap-3 px-5 pb-5 pt-2">
        <Segmented label="What kind of problem" value={kind} onChange={(v) => setKind(v as ReportInput["kind"])} options={[{ value: "bug", label: "Something's broken" }, { value: "content", label: "Harmful content" }, { value: "other", label: "Other" }]} />
        <label className="grid gap-1.5 text-[13px]">
          What happened?
          <textarea required minLength={3} maxLength={2000} rows={5} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={kind === "content" ? "What's wrong with this page?" : "What were you doing, and what went wrong?"} className="rounded-md bg-surface px-3 py-2 text-[14px] shadow-[0_0_0_1px_var(--line)] outline-none focus:shadow-[0_0_0_1.5px_var(--accent)]" />
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" variant="primary" pending={busy} disabled={message.trim().length < 3}>Send report</Button>
        </div>
      </form>
    </Dialog>
  );
}
