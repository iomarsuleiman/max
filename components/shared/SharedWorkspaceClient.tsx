"use client";

import Link from "next/link";
import { SignInButton, useAuth, useUser } from "@clerk/nextjs";
import { useAction, useConvexAuth, useMutation, useQueries } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { CLOUD } from "@/lib/config";
import { sharedPageList, sharedPageView, workspaceOverview, type SharedPageView } from "@/lib/domain/collaboration/sharedContract";
import { Button, Input, Spinner } from "@/components/ui";
import WorkspaceHome from "./WorkspaceHome";
import { WorkspaceMembers } from "./WorkspaceMembers";
import { SharedDocument, quarantineSharedDraft } from "./SharedDocument";

type Route = { kind: "home" } | { kind: "workspace"; workspaceId: string; pageId?: string } | { kind: "join"; token: string };
export default function SharedWorkspaceClient({ route }: { route: Route }) {
  if (!CLOUD) return <main className="p-8 text-fg"><p>Shared workspaces require a configured cloud account.</p><Link href="/start" className="underline">Back to Max</Link></main>;
  return <Authenticated route={route} />;
}
function Authenticated({ route }: { route: Route }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { isLoaded, user } = useUser();
  const { sessionId } = useAuth();
  if (isLoading || !isLoaded) return <main className="p-8"><Spinner label="Loading account" /></main>;
  if (!isAuthenticated || !user || !sessionId) return <main className="space-y-4 p-8 text-fg"><p>Sign in to use shared workspaces.</p><SignInButton mode="modal"><Button variant="primary">Sign in</Button></SignInButton></main>;
  const sessionKey = JSON.stringify([user.id, sessionId]);
  if (route.kind === "home") return <WorkspaceHome key={sessionKey} actorId={user.id} />;
  if (route.kind === "join") return <Join key={sessionKey} token={route.token} />;
  return <Workspace key={JSON.stringify([sessionKey, route.workspaceId, route.pageId])} actorId={user.id} workspaceId={route.workspaceId} pageId={route.pageId} />;
}
function Join({ token }: { token: string }) {
  const accept = useAction(api.sharedWorkspaces.accept);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function join() {
    setPending(true); setError("");
    try { const result = await accept({ token }); router.replace(`/spaces/${encodeURIComponent(result.workspaceId)}`); }
    catch { setError("This invitation could not be accepted. Check that you signed in with the invited email and that the link is still valid."); setPending(false); }
  }
  return <main className="mx-auto max-w-xl space-y-4 p-8 text-fg"><h1 className="text-2xl font-semibold">Join a workspace</h1>{!token ? <p role="alert">This invitation link is missing its token.</p> : <><p>Accept the invitation with the account matching the invited email address.</p><Button variant="primary" pending={pending} onClick={() => void join()}>Accept invitation</Button></>}{error && <p role="alert">{error}</p>}</main>;
}
function Workspace({ actorId, workspaceId, pageId }: { actorId: string; workspaceId: string; pageId?: string }) {
  const router = useRouter();
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [lost, setLost] = useState(false);
  const create = useMutation(api.sharedPages.create);
  const queries = {
    workspace: { query: api.sharedWorkspaces.get, args: { workspaceId } },
    ...Object.fromEntries(cursors.map((cursor, i) => [`pages${i}`, { query: api.sharedPages.list, args: { workspaceId, cursor } }])),
    ...(pageId ? { page: { query: api.sharedPages.get, args: { workspaceId, pageId: pageId as Id<"pages"> } } } : {}),
  };
  const results = useQueries(queries);
  const rawWorkspace = results.workspace;
  const parsedWorkspace = rawWorkspace && !(rawWorkspace instanceof Error) ? workspaceOverview.safeParse(rawWorkspace) : null;
  const workspace = parsedWorkspace?.success ? parsedWorkspace.data : null;
  const rawPage = results.page;
  const parsedPage = rawPage && !(rawPage instanceof Error) ? sharedPageView.safeParse(rawPage) : null;
  const view = parsedPage?.success ? parsedPage.data : null;
  const pageResults = cursors.map((_, i) => results[`pages${i}`]);
  const parsedLists = pageResults.map(raw => raw && !(raw instanceof Error) ? sharedPageList.safeParse(raw) : null);
  const failed = rawWorkspace instanceof Error || (parsedWorkspace && !parsedWorkspace.success) || pageResults.some(raw => raw instanceof Error) || parsedLists.some(p => p && !p.success) || (pageId && (rawPage instanceof Error || (parsedPage && !parsedPage.success)));
  const lastIdentity = useRef<{ actorId: string; workspaceId: string; pageId: string } | null>(null);
  useEffect(() => { if (view) lastIdentity.current = { actorId: view.actorId, workspaceId: view.workspaceId, pageId: view.page.id }; }, [view]);
  useEffect(() => { const identity = lastIdentity.current; if ((failed || lost) && identity) quarantineSharedDraft(identity.actorId, identity.workspaceId, identity.pageId); }, [failed, lost]);
  if (failed || lost) return <main className="p-8 text-fg"><p role="alert">This workspace or page is unavailable. Refresh to try again.</p><Link href="/spaces" className="underline">Workspaces</Link></main>;
  if (!workspace || workspace.actorId !== actorId || pageResults.some(raw => raw === undefined) || parsedLists.some(p => p?.success && p.data.actorId !== actorId) || (pageId && (!view || view.actorId !== actorId))) return <main className="p-8"><Spinner label="Loading workspace" /></main>;
  const pages = parsedLists.flatMap(p => p?.success ? p.data.pages : []);
  const lastList = parsedLists.at(-1);
  const nextCursor = lastList?.success ? lastList.data.nextCursor : null;
  const navigate = (id: string) => router.push(`/spaces/${encodeURIComponent(workspaceId)}/pages/${encodeURIComponent(id)}`);
  async function createPage(event: FormEvent) {
    event.preventDefault(); const teamspace = workspace?.teamspaces[0]; if (!teamspace || !title.trim()) return;
    setBusy(true); setError("");
    try { const result = await create({ workspaceId, teamspaceId: teamspace.id, title: title.trim() }); setTitle(""); navigate(result.pageId); }
    catch { setError("Couldn't create this page. Check your access and try again."); } finally { setBusy(false); }
  }
  async function createSubpage() {
    if (!view?.page.teamspaceId) return null;
    try { const result = await create({ workspaceId, teamspaceId: view.page.teamspaceId, parentId: view.page.id as Id<"pages">, title: "Untitled" }); return { id: result.pageId, title: "Untitled" }; }
    catch { setError("Couldn't create a subpage. Check your access and try again."); return null; }
  }
  return <main className="mx-auto max-w-5xl space-y-6 px-5 py-8 text-fg"><header><Link href="/spaces" className="text-sm text-fg-2 underline">Workspaces</Link><h1 className="mt-2 text-2xl font-semibold">{workspace.name}</h1></header>
    <section className="rounded-xl border border-line bg-canvas p-5"><h2 className="font-semibold">Pages</h2><ul className="mt-3 space-y-2">{pages.map(p => <li key={p.id}><Link className="underline" href={`/spaces/${encodeURIComponent(workspaceId)}/pages/${encodeURIComponent(p.id)}`}>{p.title}</Link></li>)}</ul>{!pages.length && <p className="mt-3 text-sm text-fg-2">No visible pages in this batch.</p>}{nextCursor && <Button className="mt-3" onClick={() => setCursors(c => [...c, nextCursor])}>Load more</Button>}
    {workspace.role !== "guest" && workspace.teamspaces.length > 0 && <form onSubmit={createPage} className="mt-4 flex gap-2"><Input aria-label="New page title" placeholder="Page title" value={title} onChange={e => setTitle(e.target.value)} maxLength={500} /><Button variant="primary" pending={busy} disabled={!title.trim()}>Create page</Button></form>}</section>
    {error && <p role="alert">{error}</p>}
    {view && <section className="rounded-xl border border-line bg-canvas p-5"><PageTitle view={view} /><SharedDocument view={view} pages={pages} onNavigate={navigate} onCreateSubpage={createSubpage} onAccessLost={() => setLost(true)} /><PageGrants view={view} members={workspace.members} /></section>}
    <WorkspaceMembers workspace={workspace} /></main>;
}
function PageTitle({ view }: { view: SharedPageView }) {
  const rename = useMutation(api.sharedPages.rename);
  const [title, setTitle] = useState(view.page.title);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [baseTitle, setBaseTitle] = useState(view.page.title);
  if (baseTitle !== view.page.title) {
    if (title === baseTitle) setTitle(view.page.title);
    setBaseTitle(view.page.title);
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!title.trim()) return;
    setBusy(true); setError("");
    try { await rename({ workspaceId: view.workspaceId, pageId: view.page.id as Id<"pages">, title: title.trim() }); }
    catch { setError("Couldn't rename this page. Check your access and try again."); } finally { setBusy(false); }
  }
  if (!view.canRename) return <h2 className="mb-4 text-xl font-semibold">{view.page.title}</h2>;
  return <form onSubmit={submit} className="mb-4 flex gap-2"><Input aria-label="Page title" value={title} maxLength={500} onChange={e => setTitle(e.target.value)} /><Button disabled={!title.trim() || title.trim() === view.page.title} pending={busy}>Rename</Button>{error && <p role="alert">{error}</p>}</form>;
}
function PageGrants({ view, members }: { view: SharedPageView; members: { userId: string; displayName: string }[] }) {
  const setGrant = useMutation(api.sharedPages.setMemberGrant);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const people = [...members, ...view.permissions.filter(p => !members.some(m => m.userId === p.userId))];
  if (!view.canShare || !people.length) return null;
  async function change(userId: string, value: string) {
    const grant = value === "view" || value === "comment" || value === "edit_content" || value === "edit" || value === "full" ? value : null;
    setBusy(true); setError("");
    try { await setGrant({ workspaceId: view.workspaceId, pageId: view.page.id as Id<"pages">, userId, grant, baseRevision: view.aclRevision }); }
    catch { setError("Couldn't update access. Refresh and try again."); } finally { setBusy(false); }
  }
  return <section className="mt-6 border-t border-line pt-4"><h3 className="font-semibold">Page access</h3><p className="text-sm text-fg-2">Choose explicit access for workspace members. Inherited access may still apply when no explicit grant is set.</p>{error && <p role="alert">{error}</p>}<ul>{people.map(m => <li key={m.userId} className="flex items-center justify-between gap-4 py-2"><label htmlFor={`grant-${m.userId}`}>{m.displayName}</label><select id={`grant-${m.userId}`} className="rounded bg-overlay p-2 text-sm" value={view.permissions.find(p => p.userId === m.userId)?.grant ?? ""} disabled={busy || m.userId === view.actorId} onChange={e => void change(m.userId, e.target.value)}><option value="">No explicit grant</option><option value="view">View</option><option value="comment">Comment</option><option value="edit_content">Edit content</option><option value="edit">Edit</option><option value="full">Full access</option></select></li>)}</ul></section>;
}
