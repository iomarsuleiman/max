"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button, Dialog, Field, Input, Textarea } from "@/components/ui";
import { notifyError } from "@/components/workspace/context";
import { useOrgApi } from "@/lib/client/organizations";
import { switchWorkspace } from "@/lib/client/workspace";

/** Name an organization; you become its owner and land in it, ready to invite people. */
export function NewOrganizationDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const api = useOrgApi();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const org = await api.call<{ id: string; name: string }>("create", { name: name.trim(), description: description.trim() });
      toast.success(`${org.name} is ready. Invite your team next.`, { duration: 2500 });
      onOpenChange(false);
      switchWorkspace(org.id, "/org?tab=members");
    } catch (err) {
      notifyError(err, "Couldn't create the organization.");
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New organization" description="A shared workspace for a company or team. Its pages, databases and files belong to the organization, and members edit them together.">
      <form onSubmit={submit} className="grid gap-4 px-5 pb-5 pt-2">
        <Field label="Name" htmlFor="org-name">
          <Input id="org-name" autoFocus value={name} maxLength={80} required placeholder="Acme Inc." onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description (optional)" htmlFor="org-description">
          <Textarea id="org-description" value={description} maxLength={500} rows={2} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <p className="text-[12.5px] text-fg-3">Your personal workspaces stay private. Nothing moves into the organization unless you put it there.</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" pending={busy} disabled={!name.trim()}>
            Create organization
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
