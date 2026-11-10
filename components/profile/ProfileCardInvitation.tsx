"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { notifyError, useWorkspace } from "@/components/workspace/context";

/** A quiet onboarding invitation; never takes focus away from a page. */
export function ProfileCardInvitation() {
  const ws = useWorkspace();
  const [busy, setBusy] = useState(false);
  if (
    !ws.settings?.onboarded ||
    ws.settings.profileCardOnboarded ||
    ws.settings.profileCard ||
    ws.settingsSection ||
    ws.importOpen ||
    ws.searchOpen ||
    ws.mobileNavOpen ||
    ws.peek
  )
    return null;
  const skip = async () => {
    setBusy(true);
    try {
      await ws.call("settings.update", { profileCardOnboarded: true });
    } catch (err) {
      notifyError(err, "Couldn't dismiss this invitation. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <aside
      aria-label="Personalize your workspace"
      className="border-line-strong bg-overlay shadow-dialog fixed end-4 bottom-4 z-40 w-[min(340px,calc(100vw-32px))] rounded-2xl border p-5"
    >
      <p className="text-sm font-semibold">A little card. All you.</p>
      <p className="text-fg-2 mt-1 text-[13px] leading-relaxed">Give your card a name, change its artwork, and keep a copy for yourself.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" variant="primary" onClick={() => ws.openSettings("account")}>
          Create my card
        </Button>
        <Button size="sm" variant="ghost" pending={busy} onClick={skip}>
          Maybe later
        </Button>
      </div>
    </aside>
  );
}
