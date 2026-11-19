"use client";

import { useState } from "react";
import { Plus, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui";
import { invalidateLocal, useJoinShared } from "@/lib/client/data";
import { pageTitle } from "@/lib/client/format";
import { notifyError } from "@/components/workspace/context";
import { useLinkToken, type PageAccess } from "./access";

/**
 * Shown when you opened a page through its link: join it (or its teamspace) so it stays in your
 * sidebar, like an invitation.
 */
export function JoinBanner({ invite }: { invite: NonNullable<PageAccess["invite"]> }) {
  const join = useJoinShared();
  const token = useLinkToken();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  if (done) return null;
  const name = pageTitle(invite.title);
  return (
    <div role="region" aria-label="Invitation" className="flex flex-wrap items-center gap-3 border-b border-line bg-accent-soft px-4 py-2.5 text-[13.5px] text-fg sm:px-6">
      {invite.teamspace ? <UsersRound className="size-4 shrink-0 text-accent-text" aria-hidden /> : <Plus className="size-4 shrink-0 text-accent-text" aria-hidden />}
      <p className="min-w-0 flex-1">
        {invite.teamspace ? (
          <>You were invited to the <strong className="font-semibold">{name}</strong> teamspace by link.</>
        ) : (
          <>You opened <strong className="font-semibold">{name}</strong> through a link. Add it to keep it in your sidebar.</>
        )}
      </p>
      <Button
        size="sm"
        variant="primary"
        pending={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await join(invite.pageId, token);
            await invalidateLocal().catch(() => undefined);
            toast.success(invite.teamspace ? `Joined ${name}` : `Added ${name} to your sidebar`);
            setDone(true);
          } catch (err) {
            notifyError(err, "Couldn't join.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {invite.teamspace ? "Join teamspace" : "Add to my sidebar"}
      </Button>
    </div>
  );
}
