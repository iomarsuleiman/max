"use client";

import { useState } from "react";
import { Building2 } from "@/components/icons";
import { toast } from "sonner";
import { Button } from "@/components/ui";
import { notifyError } from "@/components/workspace/context";
import { ROLE_LABEL, useMyOrgs, useOrgApi, type OrgInvitation } from "@/lib/client/organizations";
import { switchWorkspace } from "@/lib/client/workspace";
import { timeAgo } from "@/lib/client/format";

/**
 * Invitations waiting for you, above the sidebar's foot. They're tied to your verified email, so
 * only you see them; accepting opens the organization.
 */
export function PendingInvitations() {
  const mine = useMyOrgs();
  const invitations = mine.data?.invitations ?? [];
  const joinable = mine.data?.joinable ?? [];
  if (!invitations.length && !joinable.length) return null;
  return (
    <section aria-label="Invitations" className="mx-1 mb-2 grid gap-2">
      {invitations.slice(0, 3).map((i) => (
        <Invitation key={i.id} invite={i} />
      ))}
      {joinable.slice(0, 2).map((o) => (
        <DomainJoin key={o.orgId} org={o} />
      ))}
    </section>
  );
}

function Invitation({ invite }: { invite: OrgInvitation }) {
  const api = useOrgApi();
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const answer = async (action: "accept" | "decline") => {
    setBusy(action);
    try {
      const r = await api.call<{ orgId?: string; name?: string; role?: string }>("answerInvite", { inviteId: invite.id, action });
      if (action === "accept" && r.orgId) {
        // Guests only open the pages shared with them (under Shared), not the organization.
        if (r.role === "guest") toast.success(`You joined ${r.name ?? invite.orgName} as a guest. Pages shared with you appear under Shared.`);
        else {
          toast.success(`Welcome to ${r.name ?? invite.orgName}`);
          switchWorkspace(r.orgId);
        }
      }
    } catch (err) {
      notifyError(err, "Couldn't answer the invitation.");
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="rounded-lg bg-surface p-2.5 text-[12.5px] shadow-[0_0_0_1px_var(--line)]">
      <p className="flex items-center gap-1.5 font-medium text-fg">
        <Building2 className="size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">{invite.orgName}</span>
      </p>
      <p className="mt-0.5 text-fg-3">
        {invite.invitedByName ? `${invite.invitedByName} invited you` : "You're invited"} as {ROLE_LABEL[invite.role].toLowerCase()} · {timeAgo(invite.createdAt)}
      </p>
      <div className="mt-2 flex gap-1.5">
        <Button size="xs" variant="primary" pending={busy === "accept"} disabled={!!busy} onClick={() => answer("accept")}>
          Join
        </Button>
        <Button size="xs" variant="ghost" pending={busy === "decline"} disabled={!!busy} onClick={() => answer("decline")}>
          Decline
        </Button>
      </div>
    </div>
  );
}

/** Your company's organization, open to everyone with a verified email at its domain. */
function DomainJoin({ org }: { org: { orgId: string; orgName: string } }) {
  const api = useOrgApi();
  const [busy, setBusy] = useState(false);
  return (
    <div className="rounded-lg bg-surface p-2.5 text-[12.5px] shadow-[0_0_0_1px_var(--line)]">
      <p className="flex items-center gap-1.5 font-medium text-fg">
        <Building2 className="size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">{org.orgName}</span>
      </p>
      <p className="mt-0.5 text-fg-3">Your work email lets you join this organization.</p>
      <Button
        size="xs"
        variant="primary"
        className="mt-2"
        pending={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api.call("joinDomain", { orgId: org.orgId });
            toast.success(`Welcome to ${org.orgName}`);
            switchWorkspace(org.orgId);
          } catch (err) {
            notifyError(err, "Couldn't join.");
            setBusy(false);
          }
        }}
      >
        Join
      </Button>
    </div>
  );
}
