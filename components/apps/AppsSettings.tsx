"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Blocks, Bot, Code2, Copy, FileInput, Plug, Trash2 } from "@/components/icons";
import { toast } from "sonner";
import { Button, Dialog, Field, Input, Textarea, confirmAction } from "@/components/ui";
import { notifyError } from "@/components/workspace/context";
import { PageIcon } from "@/components/workspace/PageIcon";
import { EVENT_LIST, SCOPE_LABEL, useAppsApi, useAppsRead, type AppListing, type Installation } from "@/lib/client/apps";
import { activeWorkspace } from "@/lib/client/workspace";
import { timeAgo } from "@/lib/client/format";

function AppIcon({ app, size = 20 }: { app: Pick<AppListing, "icon"> | null; size?: number }) {
  return <span className="grid shrink-0 place-items-center rounded-lg bg-surface-2 shadow-[inset_0_0_0_1px_var(--line)]" style={{ width: size + 12, height: size + 12 }}>{app?.icon ? <PageIcon icon={app.icon} size={size} /> : <Blocks className="text-fg-2" style={{ width: size * 0.8, height: size * 0.8 }} />}</span>;
}

/** Settings → Connections: the marketplace, what's connected here, and apps you're building. */
export function AppsSettings() {
  return (
    <div className="mb-6 grid gap-4">
      <Marketplace />
      <Connected />
      <Developer />
    </div>
  );
}

function Marketplace() {
  const q = useAppsRead<{ apps: AppListing[] }>("marketplace", {});
  const listed = (q.data?.apps ?? []).filter((a) => a.status === "published");
  const builtIn = [
    { name: "Notion", hint: "Import pages, databases, colors and images", icon: <FileInput className="size-4" />, href: "#notion" },
    { name: "AI assistants (MCP)", hint: "Claude, ChatGPT, Cursor and other MCP clients", icon: <Bot className="size-4" />, href: "#assistants" },
    { name: "Your own app (API)", hint: "Build a connector: REST API, OAuth and webhooks", icon: <Code2 className="size-4" />, href: "#developers" },
  ];
  return (
    <section className="settings-card py-4" aria-label="Marketplace">
      <h3 className="mb-1 flex items-center gap-2 text-[14px] font-semibold"><Plug className="size-4 text-fg-3" /> Marketplace</h3>
      <p className="mb-3 text-[12.5px] text-fg-3">Apps that work with Max. Every listed app is reviewed by Max&apos;s team, and only gets the permissions you approve.</p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {builtIn.map((b) => (
          <li key={b.name}>
            <a href={b.href} className="flex items-start gap-2.5 rounded-lg p-2.5 shadow-[0_0_0_1px_var(--line)] hover:bg-hover">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2">{b.icon}</span>
              <span className="min-w-0 text-[13px]"><span className="block font-medium">{b.name} <span className="text-[11.5px] font-normal text-fg-3">· built in</span></span><span className="block text-fg-3">{b.hint}</span></span>
            </a>
          </li>
        ))}
        {listed.map((a) => (
          <li key={a.id}>
            <Link href={`/apps/${a.id}`} className="flex items-start gap-2.5 rounded-lg p-2.5 shadow-[0_0_0_1px_var(--line)] hover:bg-hover">
              <AppIcon app={a} size={16} />
              <span className="min-w-0 text-[13px]"><span className="block font-medium">{a.name}</span><span className="line-clamp-2 block text-fg-3">{a.description}</span></span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Connected() {
  const api = useAppsApi();
  const ws = activeWorkspace();
  const q = useAppsRead<{ installations: Installation[] }>("installed", { ws });
  const list = q.data?.installations ?? [];
  if (q.error) return null; // e.g. organization members who aren't admins
  return (
    <section className="settings-card py-4" aria-label="Connected apps">
      <h3 className="mb-2 text-[14px] font-semibold">Connected to this workspace</h3>
      {list.length === 0 ? (
        <p className="text-[13px] text-fg-3">No apps yet. Connect one from the marketplace above.</p>
      ) : (
        <ul className="divide-y divide-line">
          {list.map((i) => (
            <li key={i.id} className="flex items-center gap-3 py-2.5 text-[13px]">
              <AppIcon app={i.app} size={14} />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{i.app?.name ?? "Deleted app"}</span>
                <span className="block truncate text-[12px] text-fg-3">{i.scopes.map((s) => SCOPE_LABEL[s] ?? s).join(" · ")} · {i.lastUsedAt ? `used ${timeAgo(i.lastUsedAt)}` : i.connected ? "not used yet" : "waiting for the app"}</span>
              </span>
              <Button
                size="xs"
                variant="ghost"
                className="text-danger hover:bg-danger-soft"
                onClick={async () => {
                  if (!(await confirmAction({ title: `Disconnect ${i.app?.name ?? "this app"}?`, body: <p>It loses access immediately.</p>, confirmLabel: "Disconnect", tone: "danger" }))) return;
                  api.call("revoke", { installationId: i.id }).then(() => toast.success("Disconnected"), (e) => notifyError(e));
                }}
              >
                Disconnect
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Developer() {
  const api = useAppsApi();
  const q = useAppsRead<{ apps: AppListing[] }>("mine", {});
  const [editing, setEditing] = useState<AppListing | "new" | null>(null);
  const [secrets, setSecrets] = useState<{ clientId?: string; clientSecret: string; signingSecret: string } | null>(null);
  const act = (action: string, appId: string, done: string) =>
    api.call<{ clientSecret?: string; signingSecret?: string }>("manage", { action, appId }).then(
      (r) => {
        toast.success(done);
        if (r.clientSecret && r.signingSecret) setSecrets({ clientId: appId, clientSecret: r.clientSecret, signingSecret: r.signingSecret });
      },
      (e) => notifyError(e),
    );
  return (
    <section id="developers" className="settings-card py-4" aria-label="Your apps">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="flex-1 text-[14px] font-semibold">Build an app</h3>
        <Button size="sm" variant="primary" onClick={() => setEditing("new")}>New app</Button>
      </div>
      <p className="mb-3 text-[12.5px] text-fg-3">
        Register an app to use Max&apos;s API (POST /api/v1/ops with an app token), sign people in with OAuth, and get webhooks. Keep it private for your own workspaces, or submit it for the marketplace.
      </p>
      {(q.data?.apps ?? []).length > 0 && (
        <ul className="divide-y divide-line">
          {q.data!.apps.map((a) => (
            <li key={a.id} className="grid gap-1.5 py-2.5 text-[13px]">
              <div className="flex items-center gap-3">
                <AppIcon app={a} size={14} />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{a.name} <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[11px] font-normal capitalize text-fg-2">{a.status}</span></span>
                  <span className="block truncate font-mono text-[11.5px] text-fg-3">client_id {a.clientId}</span>
                </span>
                <Button size="xs" variant="ghost" onClick={() => setEditing(a)}>Edit</Button>
                <Link href={`/apps/${a.id}`} className="rounded px-2 py-1 text-[12px] hover:bg-hover">Connect</Link>
                {(a.status === "private" || a.status === "rejected") && <Button size="xs" variant="ghost" onClick={() => act("submit", a.id, "Submitted for review")}>Submit</Button>}
                <Button size="xs" variant="ghost" onClick={() => act("rotate", a.id, "New secrets created. The old ones stop working now.")}>New secrets</Button>
                <Button size="xs" variant="ghost" aria-label={`Delete ${a.name}`} onClick={async () => (await confirmAction({ title: `Delete ${a.name}?`, body: <p>Every workspace it&apos;s connected to loses it.</p>, confirmLabel: "Delete app", tone: "danger" })) && act("delete", a.id, "App deleted")}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
              {a.reviewNote && <p className="ps-9 text-[12px] text-warning">Review: {a.reviewNote}</p>}
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <AppEditor
          app={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onCreated={(s) => setSecrets(s)}
        />
      )}
      {secrets && (
        <Dialog open onOpenChange={(o) => !o && setSecrets(null)} title="Save these secrets now" description="They're shown only once. Keep them on your app's server, never in a browser or a repository.">
          <div className="grid gap-2 px-5 pb-5 pt-2 font-mono text-[12.5px]">
            {secrets.clientId && <Secret label="client_id" value={secrets.clientId} />}
            <Secret label="client_secret" value={secrets.clientSecret} />
            <Secret label="webhook signing secret" value={secrets.signingSecret} />
            <div className="flex justify-end">
              <Button variant="primary" onClick={() => setSecrets(null)}>I saved them</Button>
            </div>
          </div>
        </Dialog>
      )}
    </section>
  );
}

function Secret({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-sans text-[12px] text-fg-3">{label}</p>
      <div className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate">{value}</span>
        <Button size="xs" variant="ghost" icon={<Copy className="size-3.5" />} onClick={() => navigator.clipboard.writeText(value).then(() => toast.success("Copied"))}>Copy</Button>
      </div>
    </div>
  );
}

function AppEditor({ app, onClose, onCreated }: { app: AppListing | null; onClose: () => void; onCreated: (s: { clientId: string; clientSecret: string; signingSecret: string }) => void }) {
  const api = useAppsApi();
  const [name, setName] = useState(app?.name ?? "");
  const [description, setDescription] = useState(app?.description ?? "");
  const [website, setWebsite] = useState(app?.website ?? "");
  const [scopes, setScopes] = useState<Set<string>>(new Set(app?.scopes ?? ["read_content"]));
  const [redirects, setRedirects] = useState((app?.redirectUris ?? []).join("\n"));
  const [webhook, setWebhook] = useState(app?.webhookUrl ?? "");
  const [events, setEvents] = useState<Set<string>>(new Set(app?.events ?? []));
  const [busy, setBusy] = useState(false);
  const toggle = (set: Set<string>, v: string) => {
    const n = new Set(set);
    if (n.has(v)) n.delete(v);
    else n.add(v);
    return n;
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const payload = { name, description, website: website.trim() || null, scopes: [...scopes], redirectUris: redirects.split(/\s+/).filter(Boolean), webhookUrl: webhook.trim() || null, events: [...events] };
    try {
      if (app) {
        const r = await api.call<{ status: string }>("manage", { action: "update", appId: app.id, app: payload });
        toast.success(r.status === "submitted" && app.status === "published" ? "Saved. It asks for more now, so it's back in review." : "Saved");
      } else {
        const r = await api.call<{ clientId: string; clientSecret: string; signingSecret: string }>("manage", { action: "create", app: payload });
        onCreated(r);
      }
      onClose();
    } catch (err) {
      notifyError(err);
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={app ? `Edit ${app.name}` : "New app"} size="lg">
      <form onSubmit={submit} className="grid gap-3 px-5 pb-5 pt-2 text-[13px]">
        <Field label="Name" htmlFor="app-name"><Input id="app-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} required /></Field>
        <Field label="What it does" htmlFor="app-desc"><Textarea id="app-desc" rows={2} value={description} maxLength={600} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label="Website" htmlFor="app-site"><Input id="app-site" value={website} placeholder="https://example.com" onChange={(e) => setWebsite(e.target.value)} /></Field>
        <fieldset className="grid gap-1.5">
          <legend className="mb-1 font-medium">Permissions it asks for</legend>
          {Object.entries(SCOPE_LABEL).map(([k, label]) => (
            <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={scopes.has(k)} onChange={() => setScopes((s) => toggle(s, k))} /> {label}</label>
          ))}
        </fieldset>
        <Field label="OAuth redirect addresses" htmlFor="app-redirects" help="One per line. https://, or http://localhost while developing. Leave empty to connect with a token people copy.">
          <Textarea id="app-redirects" rows={2} value={redirects} onChange={(e) => setRedirects(e.target.value)} placeholder="https://example.com/oauth/max/callback" />
        </Field>
        <Field label="Webhook address" htmlFor="app-webhook" help="Max POSTs signed JSON (ids and event names, never content) here when the events below happen.">
          <Input id="app-webhook" value={webhook} placeholder="https://example.com/webhooks/max" onChange={(e) => setWebhook(e.target.value)} />
        </Field>
        <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
          <legend className="mb-1 font-medium">Events</legend>
          {EVENT_LIST.map((e) => (
            <label key={e} className="flex items-center gap-1.5 font-mono text-[12px]"><input type="checkbox" checked={events.has(e)} onChange={() => setEvents((s) => toggle(s, e))} /> {e}</label>
          ))}
        </fieldset>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" pending={busy} disabled={!name.trim() || !scopes.size}>{app ? "Save" : "Create app"}</Button>
        </div>
      </form>
    </Dialog>
  );
}
