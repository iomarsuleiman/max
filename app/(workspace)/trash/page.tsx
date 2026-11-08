"use client";

import { Topbar } from "@/components/workspace/Topbar";
import { TrashPanel } from "@/components/workspace/TrashPanel";

export default function TrashPage() {
  return (
    <>
      <Topbar crumbs={[{ href: "/trash", title: "Trash" }]} />
      <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-4 py-8">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">Trash</h1>
        <p className="mb-4 text-[13.5px] text-fg-2">Deleted pages stay here until you delete them permanently or empty the trash. Restoring a page brings back everything that was inside it.</p>
        <div className="rounded-lg shadow-[0_0_0_1px_var(--line)]">
          <TrashPanel />
        </div>
      </div>
    </>
  );
}
