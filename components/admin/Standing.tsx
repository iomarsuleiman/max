"use client";

import { Ban, PauseCircle } from "lucide-react";
import { Button } from "@/components/ui";
import { LogoMark } from "@/components/brand/Logo";
import { useOp } from "@/lib/client/data";
import { dateTime } from "@/lib/client/format";
import { useWorkspace } from "@/components/workspace/context";

export interface Standing {
  status: "active" | "suspended" | "banned";
  reason: string | null;
  since: number | null;
}

export function useStanding() {
  return useOp<Standing>("account.standing", {}).data ?? null;
}

/** A banned account sees why, in the admin's words, instead of the workspace. */
export function BannedScreen({ standing }: { standing: Standing }) {
  const ws = useWorkspace();
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-4 text-fg">
      <div className="w-full max-w-md rounded-2xl bg-surface p-7 text-center shadow-[0_0_0_1px_var(--line)]" role="alert">
        <LogoMark className="mx-auto size-8" />
        <Ban className="mx-auto mt-5 size-6 text-danger" aria-hidden />
        <h1 className="mt-3 text-[20px] font-semibold">This account has been banned</h1>
        {standing.reason && (
          <blockquote className="mt-4 rounded-lg bg-canvas px-4 py-3 text-start text-[14px] leading-relaxed text-fg shadow-[0_0_0_1px_var(--line)]">
            <p className="mb-1 text-[12px] font-medium text-fg-3">Reason from Max&apos;s team</p>
            {standing.reason}
          </blockquote>
        )}
        <p className="mt-4 text-[13px] text-fg-2">
          {standing.since ? `Since ${dateTime(standing.since)}. ` : ""}Your pages aren&apos;t deleted. If you think this is a mistake, reply to Max&apos;s team or report it from max.chaos.fail.
        </p>
        {ws.identity.signOut && (
          <Button className="mt-5" onClick={() => ws.identity.signOut?.()}>
            Sign out
          </Button>
        )}
      </div>
    </main>
  );
}

/** A suspended account keeps reading; this says why and that changes are paused. */
export function SuspendedBanner({ standing }: { standing: Standing }) {
  return (
    <div role="alert" className="flex items-start gap-2.5 border-b border-line bg-warning-soft px-4 py-2.5 text-[13.5px] text-fg">
      <PauseCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p className="min-w-0">
        <strong className="font-semibold">Your account is suspended.</strong> You can read your pages, but changes are paused.
        {standing.reason && (
          <>
            {" "}
            Reason: <span className="italic">“{standing.reason}”</span>
          </>
        )}
      </p>
    </div>
  );
}
