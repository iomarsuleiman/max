"use client";

import { useEffect } from "react";
import { ArrowLeft, Layers3, LockKeyhole } from "@/components/icons";
import { useWorkspaceNavigation } from "./WorkspaceRail";
import { workspacePreviewHref } from "@/lib/domain/workspaceNavigation";

/** Metadata-only landing page. Do not mount PageView, search or legacy notes here. */
export function WorkspacePreviewPage({ workspaceId }: { workspaceId: string }) {
  const { workspaces, loading, error } = useWorkspaceNavigation();
  const permitted = workspacePreviewHref(workspaceId) !== null &&
    workspaces.some((workspace) => workspace.workspaceId === workspaceId);

  // Keep the browser title generic if membership was revoked or the URL forged.
  useEffect(() => { document.title = "Workspace preview · Max"; }, []);

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4 text-[13px] text-fg-2">
        <Layers3 className="size-4" aria-hidden />
        Workspace navigation preview
      </header>
      <div className="grid flex-1 place-items-center px-6 py-12">
        <div role="status" aria-live="polite" className="max-w-md text-center">
          <div className="mx-auto mb-5 grid size-12 place-items-center rounded-2xl bg-surface">
            {permitted ? <Layers3 className="size-6 text-fg-2" /> : <LockKeyhole className="size-6 text-fg-2" />}
          </div>
          <h1 className="text-lg font-semibold text-fg">
            {loading ? "Checking workspace access…" : permitted && !error ? workspaceId : "Workspace unavailable"}
          </h1>
          <p className="mt-2 text-[13px] leading-relaxed text-fg-2">
            {loading ? "Verifying your current signed-in membership." :
              permitted && !error
                ? "Your membership is active. Shared pages and collaboration are not enabled yet. Your private notes stay in their original workspace."
                : "This workspace doesn't exist, is disabled, or isn't accessible to your account."}
          </p>
          <a href="/home" className="mt-5 inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-[13px] text-fg hover:bg-hover">
            <ArrowLeft className="size-4 flip-rtl" aria-hidden /> Back to private notes
          </a>
        </div>
      </div>
    </section>
  );
}
