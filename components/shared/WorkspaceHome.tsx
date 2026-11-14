"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction, useQueries } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button, EmptyState, Field, Input, Spinner } from "@/components/ui";
import { workspaceList, type WorkspaceList } from "@/lib/domain/collaboration/sharedContract";

export default function WorkspaceHome({ actorId }: { actorId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const createWorkspace = useAction(api.sharedWorkspaces.create);
  const results = useQueries({ workspaces: { query: api.sharedWorkspaces.list, args: {} } });
  const raw = results.workspaces;
  const error = raw instanceof Error ? raw : null;
  const parsed = raw && !(raw instanceof Error) ? workspaceList.safeParse(raw) : null;
  const data: WorkspaceList | undefined = parsed?.success && parsed.data.actorId === actorId ? parsed.data : undefined;
  const invalidResult = parsed && !parsed.success;

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const { workspaceId } = await createWorkspace({ name: trimmedName });
      router.push(`/spaces/${encodeURIComponent(workspaceId)}`);
    } catch {
      setCreateError("Couldn't create this workspace. Try again.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10 text-fg sm:px-8">
      <header className="mb-8 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-fg-3">Shared spaces</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Your workspaces</h1>
        </div>
        <Link href="/start" className="text-sm text-fg-2 underline-offset-4 hover:text-fg hover:underline">Back to Max</Link>
      </header>

      <section aria-labelledby="workspace-list-heading" className="rounded-xl border border-line bg-canvas p-5 sm:p-6">
        <h2 id="workspace-list-heading" className="text-base font-semibold">Workspaces</h2>
        {error || invalidResult ? (
          <p role="alert" className="mt-4 rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-fg">Couldn't load your workspaces. Refresh the page to try again.</p>
        ) : raw === undefined || !data ? (
          <div className="grid min-h-28 place-items-center"><Spinner label="Loading workspaces" /></div>
        ) : data?.workspaces.length ? (
          <ul className="mt-3 divide-y divide-line">
            {data.workspaces.map((workspace) => (
              <li key={workspace.id}>
                <Link href={`/spaces/${encodeURIComponent(workspace.id)}`} className="flex items-center justify-between gap-4 rounded-md px-2 py-3 hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
                  <span className="min-w-0 truncate font-medium">{workspace.name}</span>
                  <span className="shrink-0 text-xs capitalize text-fg-3">{workspace.role}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState className="py-8" title="No shared workspaces yet" body="Create a space to work with other people." />
        )}
      </section>

      <section aria-labelledby="create-workspace-heading" className="mt-5 rounded-xl border border-line bg-canvas p-5 sm:p-6">
        <h2 id="create-workspace-heading" className="text-base font-semibold">Create a workspace</h2>
        <form onSubmit={create} className="mt-4 flex flex-col items-end gap-3 sm:flex-row">
          <div className="w-full flex-1">
            <Field label="Workspace name" htmlFor="workspace-name" error={createError}>
              <Input id="workspace-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required autoComplete="organization" placeholder="For example, Product team" />
            </Field>
          </div>
          <Button variant="primary" pending={creating} disabled={!name.trim()} className="w-full sm:w-auto">Create workspace</Button>
        </form>
      </section>
    </main>
  );
}
