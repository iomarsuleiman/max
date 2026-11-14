"use client";

import { useState, type FormEvent } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button, Field, Input } from "@/components/ui";
import type { WorkspaceOverview } from "@/lib/domain/collaboration/sharedContract";

export function WorkspaceMembers({ workspace }: { workspace: WorkspaceOverview }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "guest">("member");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ url: string; expiresAt: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [memberError, setMemberError] = useState<string | null>(null);
  const createInvitation = useAction(api.sharedWorkspaces.invite);
  const revokeMembership = useMutation(api.sharedWorkspaces.revoke);

  if (!workspace.canManageMembers) return null;

  const createInvite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedEmail = email.trim();
    if (!normalizedEmail || inviting) return;
    setInviting(true);
    setInviteError(null);
    setInvite(null);
    setCopied(false);
    try {
      const result = await createInvitation({ workspaceId: workspace.id, email: normalizedEmail, role });
      setInvite({ url: `${window.location.origin}/join?token=${encodeURIComponent(result.token)}`, expiresAt: result.expiresAt });
      setEmail("");
    } catch {
      setInviteError("Couldn't create this invitation. Check the email and try again.");
    } finally {
      setInviting(false);
    }
  };

  const copyInvite = async () => {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const revoke = async (userId: string, displayName: string) => {
    if (revoking || !window.confirm(`Remove ${displayName} from ${workspace.name}?`)) return;
    setRevoking(userId);
    setMemberError(null);
    try {
      await revokeMembership({ workspaceId: workspace.id, userId });
    } catch {
      setMemberError(`Couldn't remove ${displayName}. Try again.`);
    } finally {
      setRevoking(null);
    }
  };

  return (
    <section aria-labelledby="workspace-members-heading" className="rounded-xl border border-line bg-canvas p-5 sm:p-6">
      <h2 id="workspace-members-heading" className="text-base font-semibold">People</h2>
      {memberError && <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-fg">{memberError}</p>}
      <ul className="mt-3 divide-y divide-line">
        {workspace.members.map((member) => {
          const isYou = member.userId === workspace.actorId;
          return (
            <li key={member.userId} className="flex min-w-0 items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{member.displayName}{isYou ? <span className="ml-2 text-xs font-normal text-fg-3">You</span> : null}</p>
                <p className="text-xs capitalize text-fg-3">{member.role}</p>
              </div>
              {!isYou && (
                <Button variant="ghost" size="sm" pending={revoking === member.userId} disabled={revoking !== null} aria-label={`Remove ${member.displayName}`} onClick={() => void revoke(member.userId, member.displayName)}>Remove</Button>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-5 border-t border-line pt-5">
        <h3 className="text-sm font-semibold">Invite someone</h3>
        <form onSubmit={createInvite} className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
          <Field label="Email address" htmlFor="invite-email" error={inviteError}>
            <Input id="invite-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="person@example.com" />
          </Field>
          <Field label="Role" htmlFor="invite-role">
            <select id="invite-role" value={role} onChange={(event) => setRole(event.target.value === "guest" ? "guest" : "member")} className="h-8 w-full rounded-md bg-overlay px-2.5 text-sm text-fg shadow-[0_0_0_1px_var(--line-strong)] outline-none focus-visible:shadow-[0_0_0_1px_var(--accent),0_0_0_3px_var(--accent-soft)]">
              <option value="member">Member</option>
              <option value="guest">Guest</option>
            </select>
          </Field>
          <Button variant="primary" pending={inviting} disabled={!email.trim()} className="w-full sm:w-auto">Create invite link</Button>
        </form>
        {invite && (
          <div className="mt-4 rounded-lg border border-line bg-surface p-3" aria-live="polite">
            <p className="text-sm font-medium">Invite link ready</p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <Input aria-label="Invitation link" readOnly value={invite.url} onFocus={(event) => event.currentTarget.select()} className="font-mono text-xs" />
              <Button variant="secondary" onClick={() => void copyInvite()}>{copied ? "Copied" : "Copy link"}</Button>
            </div>
            <p className="mt-2 text-xs text-fg-3">Expires {new Date(invite.expiresAt).toLocaleString()}</p>
          </div>
        )}
        {invite && !copied && <p className="sr-only" role="status">Invitation link created. Copy it to share with the invited person.</p>}
        {copied && <p className="sr-only" role="status">Invitation link copied.</p>}
      </div>
    </section>
  );
}
