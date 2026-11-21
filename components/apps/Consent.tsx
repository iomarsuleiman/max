"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Blocks, Check, Copy, ShieldCheck } from "@/components/icons";
import { toast } from "sonner";
import { Button, EmptyState, Select, Skeleton } from "@/components/ui";
import { Topbar } from "@/components/workspace/Topbar";
import { notifyError } from "@/components/workspace/context";
import { useWorkspaces } from "@/components/workspace/Workspaces";
import { PageIcon } from "@/components/workspace/PageIcon";
import { SCOPE_LABEL, useAppsApi, useAppsRead, type AppListing } from "@/lib/client/apps";
import { activeWorkspace } from "@/lib/client/workspace";

/**
 * Connecting an app: what it is, exactly what it may do, and where. Reached from the marketplace,
 * or by the app itself (OAuth: /apps/<client_id>?redirect_uri=…&state=…).
 */
export function AppConsent({ appId }: { appId: string }) {
  const params = useSearchParams();
  const redirectUri = params.get("redirect_uri");
  const state = params.get("state");
  const api = useAppsApi();
  const q = useAppsRead<{ app: AppListing; redirectUris: string[]; scopes: { scope: string; label: string; hint: string }[] }>("info", { appId });
  const spaces = useWorkspaces();
  const targets = spaces.list.filter((w) => w.kind !== "organization" || w.role === "owner" || w.role === "admin");
  const [ws, setWs] = useState<string>(activeWorkspace() ?? "main");
  const [granted, setGranted] = useState<Set<string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  if (q.error) return <EmptyState icon={<Blocks className="size-5" />} title="This app isn't available" body={q.error.message} className="mt-24" />;
  if (!q.data) return <div className="mx-auto mt-16 w-full max-w-lg px-4"><Skeleton className="h-64" /></div>;
  const { app, scopes } = q.data;
  // Only addresses the app registered: anything else could send people somewhere else entirely.
  if (redirectUri && !q.data.redirectUris.includes(redirectUri)) return <EmptyState icon={<Blocks className="size-5" />} title="This connect link isn't valid" body={`${app.name} sent you here with a return address it hasn't registered with Max. Nothing was connected.`} className="mt-24" />;
  const chosen = granted ?? new Set(scopes.map((s) => s.scope));
  const connect = async () => {
    setBusy(true);
    try {
      const r = await api.call<{ redirect?: string; token?: string }>("install", { appId, ws: ws === "main" ? null : ws, scopes: [...chosen], redirectUri, state });
      if (r.redirect) window.location.assign(r.redirect);
      else {
        setToken(r.token ?? null);
        setBusy(false);
      }
    } catch (err) {
      notifyError(err);
      setBusy(false);
    }
  };
  return (
    <>
      <Topbar crumbs={[{ title: "Connect an app", href: `/apps/${appId}` }]} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-lg px-4 pb-24 pt-12">
          <div className="flex items-center gap-3">
            <span className="grid size-12 place-items-center rounded-xl bg-surface-2 shadow-[inset_0_0_0_1px_var(--line)]">{app.icon ? <PageIcon icon={app.icon} size={26} /> : <Blocks className="size-6 text-fg-2" />}</span>
            <div className="min-w-0">
              <h1 className="truncate text-[22px] font-bold tracking-tight">{app.name}</h1>
              <p className="text-[12.5px] text-fg-3">{app.status === "published" ? "Reviewed by Max" : "Not reviewed: only connect apps you trust"}{app.website ? <> · <a className="underline" href={app.website} target="_blank" rel="noreferrer noopener">{new URL(app.website).host}</a></> : null}</p>
            </div>
          </div>
          {app.description && <p className="mt-4 text-[14px] text-fg-2">{app.description}</p>}
          {token ? (
            <section className="settings-card mt-6 grid gap-3 py-4">
              <p className="flex items-center gap-2 text-[14px] font-medium"><Check className="size-4 text-success" /> Connected</p>
              <p className="text-[13px] text-fg-2">Paste this token into {app.name}. It&apos;s shown only now; disconnect the app any time from Settings → Connections.</p>
              <div className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-2 font-mono text-[12.5px]">
                <span className="min-w-0 flex-1 truncate">{token}</span>
                <Button size="xs" variant="ghost" icon={<Copy className="size-3.5" />} onClick={() => navigator.clipboard.writeText(token).then(() => toast.success("Copied"))}>Copy</Button>
              </div>
            </section>
          ) : (
            <section className="settings-card mt-6 grid gap-3 py-4">
              <p className="flex items-center gap-2 text-[13.5px] font-medium"><ShieldCheck className="size-4 text-fg-3" /> {app.name} wants to</p>
              <ul className="grid gap-2" aria-label="Permissions">
                {scopes.map((s) => (
                  <li key={s.scope}>
                    <label className="flex items-start gap-2.5 text-[13.5px]">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={chosen.has(s.scope)}
                        onChange={(e) => {
                          const next = new Set(chosen);
                          if (e.target.checked) next.add(s.scope);
                          else next.delete(s.scope);
                          setGranted(next);
                        }}
                      />
                      <span>
                        <span className="block">{SCOPE_LABEL[s.scope] ?? s.label}</span>
                        <span className="block text-[12px] text-fg-3">{s.hint}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <p className="text-[12px] text-fg-3">It never sees an organization&apos;s private pages it isn&apos;t added to, and can&apos;t share, publish, change accounts or delete anything permanently.</p>
              <Select label="Where" variant="filled" value={ws} onChange={setWs} options={targets.map((w) => ({ value: w.id ?? "main", label: `${w.name}${w.kind === "organization" ? " (organization)" : ""}` }))} />
              {redirectUri && <p className="text-[12px] text-fg-3">You&apos;ll go back to {(() => { try { return new URL(redirectUri).host; } catch { return "the app"; } })()} afterwards.</p>}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => (redirectUri ? window.location.assign(`${redirectUri}${redirectUri.includes("?") ? "&" : "?"}error=access_denied${state ? `&state=${encodeURIComponent(state)}` : ""}`) : history.back())}>Cancel</Button>
                <Button variant="primary" pending={busy} disabled={!chosen.size} onClick={connect}>Connect</Button>
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
