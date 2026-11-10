"use client";

import { useState, type ReactNode } from "react";
import { Dialog as D } from "radix-ui";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { zipSync, strToU8 } from "fflate";
import { ArrowDown, ArrowUp, Bot, Check, Copy, Database, Download, GripVertical, Info, Keyboard, LogOut, PanelLeft, PenLine, Settings2, Trash2, Upload, User, X } from "lucide-react";
import { toast } from "sonner";
import { Button, Field, IconButton, Input, Kbd, Notice, Segmented, Select, SettingRow, Skeleton, Switch, cn, confirmAction } from "@/components/ui";
import { PageIcon } from "@/components/workspace/PageIcon";
import { useOp, useRead } from "@/lib/client/data";
import { bytes, dateTime, pageTitle, timeAgo } from "@/lib/client/format";
import { APP_URL, CLOUD, REPO_URL, VERSION } from "@/lib/config";
import type { SettingsRow } from "@/lib/client/types";
import { Avatar } from "@/components/workspace/Sidebar";
import { notifyError, useWorkspace, type SettingsSection } from "@/components/workspace/context";
import { download } from "@/components/page/PageOptions";
import { SHORTCUTS } from "@/lib/client/shortcuts";
import { NotionConnection } from "./NotionConnection";
import { ProfileCardEditor } from "@/components/profile/ProfileCardEditor";

const NAV: { id: SettingsSection; label: string; icon: ReactNode; group: "Account" | "Workspace" }[] = [
  { id: "account", label: "My account", icon: <User />, group: "Account" },
  { id: "preferences", label: "Preferences", icon: <Settings2 />, group: "Account" },
  { id: "editor", label: "Editor", icon: <PenLine />, group: "Account" },
  { id: "sidebar", label: "Sidebar", icon: <PanelLeft />, group: "Account" },
  { id: "connections", label: "Connections", icon: <Bot />, group: "Workspace" },
  { id: "data", label: "Data & export", icon: <Database />, group: "Workspace" },
  { id: "shortcuts", label: "Keyboard shortcuts", icon: <Keyboard />, group: "Workspace" },
  { id: "about", label: "About Max", icon: <Info />, group: "Workspace" },
];

export function SettingsDialog() {
  const ws = useWorkspace();
  const section = ws.settingsSection;
  return (
    <D.Root open={!!section} onOpenChange={(o) => !o && ws.closeSettings()}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-[60] bg-[var(--scrim)] [animation:max-fade_150ms_ease]" />
        <D.Content
          aria-describedby={undefined}
          tabIndex={-1}
          onOpenAutoFocus={(e) => {
            // Keep focus in the dialog (so Esc and Tab work) without jumping to the first button.
            e.preventDefault();
            (e.currentTarget as HTMLElement).focus();
          }}
          className="fixed start-1/2 top-1/2 z-[61] flex h-[min(720px,calc(100dvh-48px))] w-[min(1080px,calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl bg-overlay shadow-dialog outline-none [animation:max-in_160ms_var(--ease)] rtl:translate-x-1/2 max-md:inset-0 max-md:h-dvh max-md:w-full max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none max-md:flex-col"
        >
          <D.Title className="sr-only">Settings</D.Title>
          <nav aria-label="Settings sections" className="flex w-60 shrink-0 flex-col gap-0.5 overflow-y-auto bg-surface px-2 py-3 max-md:w-full max-md:flex-row max-md:gap-1 max-md:overflow-x-auto max-md:border-b max-md:border-line max-md:py-2">
            {(["Account", "Workspace"] as const).map((g) => (
              <div key={g} className="contents">
                <p className="px-2 pb-1 pt-2 text-[11.5px] font-medium text-fg-3 first:pt-0 max-md:hidden">{g}</p>
                {NAV.filter((n) => n.group === g).map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    aria-current={section === n.id ? "page" : undefined}
                    onClick={() => ws.openSettings(n.id)}
                    className={cn("flex h-7 shrink-0 items-center gap-2 rounded-md px-2 text-[13.5px] text-fg-2 hover:bg-hover hover:text-fg [&>svg]:size-4 [&>svg]:text-fg-3", section === n.id && "bg-hover font-medium text-fg")}
                  >
                    {n.icon}
                    {n.label}
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <div className="relative min-w-0 flex-1 overflow-y-auto px-12 py-9 max-md:px-5 max-md:py-6">
            <D.Close asChild>
              <IconButton label="Close settings" size="md" className="absolute end-3 top-3">
                <X className="size-4" />
              </IconButton>
            </D.Close>
            {section === "account" && <AccountSection />}
            {section === "preferences" && <PreferencesSection />}
            {section === "editor" && <EditorSection />}
            {section === "sidebar" && <SidebarSection />}
            {section === "connections" && <ConnectionsSection />}
            {section === "data" && <DataSection />}
            {section === "shortcuts" && <ShortcutsSection />}
            {section === "about" && <AboutSection />}
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

function Heading({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <div className="mb-4 border-b border-line pb-3">
      <h2 className="text-[16px] font-semibold text-fg">{title}</h2>
      {description && <p className="mt-1 text-[13px] text-fg-2">{description}</p>}
    </div>
  );
}

function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      {title && <h3 className="mb-1 text-[13px] font-medium text-fg-3">{title}</h3>}
      <div className="divide-y divide-line">{children}</div>
    </section>
  );
}

function useSettings() {
  const ws = useWorkspace();
  const s = ws.settings;
  const set = <K extends keyof SettingsRow>(key: K, value: SettingsRow[K], label = "Preference saved") =>
    ws.updateSettings({ [key]: value } as Partial<SettingsRow>).then(() => toast.success(label, { duration: 1200 }));
  return { s, set, ws };
}

/* ── Account ─────────────────────────────────────────────────────────────── */

function AccountSection() {
  const { s, set, ws } = useSettings();
  const [name, setName] = useState(s?.displayName ?? "");
  const id = ws.identity;
  const deleteData = async () => {
    const ok = await confirmAction({
      title: "Delete all your data?",
      body: <p>Every page, database, file, template, token and preference in this workspace will be permanently deleted. Export first if you might want it later.</p>,
      confirmLabel: "Delete everything",
      tone: "danger",
      typeToConfirm: "delete my data",
    });
    if (!ok) return;
    try {
      const res = await ws.call<{ removed: number }>("account.deleteAllData", { confirm: true });
      toast.success(`Deleted ${res.removed.toLocaleString("en")} items. Your workspace is empty.`);
      window.location.assign(new URL("/home", window.location.origin));
    } catch (err) {
      notifyError(err, "Couldn't delete your data. Nothing was deleted, or only part was; try again.");
    }
  };
  const deleteAccount = async () => {
    const ok = await confirmAction({
      title: "Delete your account?",
      body: <p>All your Max data is deleted first, then your sign-in account. You won&apos;t be able to sign in again with it. This can&apos;t be undone.</p>,
      confirmLabel: "Delete my account",
      tone: "danger",
      typeToConfirm: "delete my account",
    });
    if (!ok) return;
    try {
      await ws.call("account.deleteAllData", { confirm: true });
      await id.deleteAccount?.();
    } catch (err) {
      notifyError(err, "Couldn't delete your account. Try again or contact support.");
    }
  };
  return (
    <>
      <Heading title="My account" />
      <Group>
        <div className="flex flex-wrap items-center gap-4 py-3">
          <Avatar name={s?.displayName || id.name} url={id.imageUrl} size={56} />
          <div className="grid min-w-60 flex-1 gap-1.5">
            <Field label="Preferred name" htmlFor="name" help="Used in greetings and your workspace name.">
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== (s?.displayName ?? "") && set("displayName", name.trim() || null, "Name saved")} placeholder={id.name} />
            </Field>
          </div>
        </div>
        {id.email && (
          <SettingRow title="Email" description={id.email}>
            {id.manageAccount && <Button size="sm" onClick={id.manageAccount}>Manage account</Button>}
          </SettingRow>
        )}
        {!CLOUD && <SettingRow title="Workspace" description="This is a private workspace stored on this device's server (local mode). Nothing is sent anywhere else."><span /></SettingRow>}
        {id.signOut && (
          <SettingRow title="Sign out" description="Sign out of Max on this device.">
            <Button size="sm" icon={<LogOut className="size-3.5" />} onClick={() => id.signOut?.()}>
              Sign out
            </Button>
          </SettingRow>
        )}
      </Group>
      <Group title="Your profile card">
        {s ? <ProfileCardEditor /> : <Skeleton className="h-64" />}
      </Group>
      <Group title="Danger zone">
        <SettingRow title="Delete all my data" description="Permanently removes every page, database, file, token and preference. Your sign-in stays.">
          <Button size="sm" variant="ghost" className="text-danger shadow-[0_0_0_1px_var(--danger)] hover:bg-danger-soft hover:text-danger" onClick={deleteData}>
            Delete all data
          </Button>
        </SettingRow>
        {id.deleteAccount && (
          <SettingRow title="Delete my account" description="Deletes your data and your sign-in account.">
            <Button size="sm" variant="danger" onClick={deleteAccount}>
              Delete account
            </Button>
          </SettingRow>
        )}
      </Group>
    </>
  );
}

/* ── Preferences ─────────────────────────────────────────────────────────── */

function PreferencesSection() {
  const { s, set, ws } = useSettings();
  if (!s) return <Skeleton className="h-40" />;
  return (
    <>
      <Heading title="Preferences" description="Saved to your account and applied on every device." />
      <Group title="Appearance">
        <SettingRow title="Theme" description="Follow your device, or always use light or dark.">
          <Segmented label="Theme" value={s.theme} onChange={(v) => set("theme", v, "Theme saved")} options={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
        </SettingRow>
        <SettingRow title="Font" description="The typeface for page content.">
          <Segmented
            label="Font"
            value={s.font}
            onChange={(v) => set("font", v, "Font saved")}
            options={[
              { value: "default", label: <span className="font-sans">Default</span> },
              { value: "serif", label: <span className="font-serif">Serif</span> },
              { value: "mono", label: <span className="font-mono text-[12px]">Mono</span> },
            ]}
          />
        </SettingRow>
        <SettingRow title="Density" description="Compact fits more on smaller screens.">
          <Segmented label="Density" value={s.density} onChange={(v) => set("density", v)} options={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]} />
        </SettingRow>
        <SettingRow title="Reduce motion" description="Turn off animations. “System” follows your device setting.">
          <Segmented label="Reduce motion" value={s.reduceMotion} onChange={(v) => set("reduceMotion", v)} options={[{ value: "system", label: "System" }, { value: "on", label: "Always" }]} />
        </SettingRow>
      </Group>
      <Group title="Pages">
        <SettingRow title="Full width for new pages" description="Each page can still be switched from its ⋯ menu.">
          <Switch label="Full width for new pages" checked={s.defaultFullWidth} onCheckedChange={(v) => set("defaultFullWidth", v)} />
        </SettingRow>
      </Group>
    </>
  );
}

/* ── Editor ──────────────────────────────────────────────────────────────── */

function EditorSection() {
  const { s, set } = useSettings();
  if (!s) return <Skeleton className="h-40" />;
  const tips: [string, string][] = [
    ["# , ## , ###", "Headings"],
    ["- or *", "Bulleted list"],
    ["1.", "Numbered list"],
    ["[]", "To-do"],
    [">", "Toggle list"],
    ["\"", "Quote"],
    ["```", "Code block"],
    ["---", "Divider"],
    ["/", "Insert any block"],
    ["@", "Link a page"],
  ];
  return (
    <>
      <Heading title="Editor" />
      <Group title="Writing">
        <SettingRow title="Text direction" description="Auto follows each paragraph's language, so English and Arabic mix naturally.">
          <Segmented label="Text direction" value={s.textDirection} onChange={(v) => set("textDirection", v)} options={[{ value: "auto", label: "Auto" }, { value: "ltr", label: "Left to right" }, { value: "rtl", label: "Right to left" }]} />
        </SettingRow>
        <SettingRow title="Spell check" description="Underline misspelled words while you type (uses your browser's dictionary).">
          <Switch label="Spell check" checked={s.spellcheck} onCheckedChange={(v) => set("spellcheck", v)} />
        </SettingRow>
      </Group>
      <Group title="Markdown shortcuts">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 py-3 text-[13px] sm:grid-cols-3">
          {tips.map(([k, v]) => (
            <div key={v} className="flex items-center justify-between gap-2">
              <dt className="text-fg-2">{v}</dt>
              <dd><Kbd>{k}</Kbd></dd>
            </div>
          ))}
        </dl>
      </Group>
    </>
  );
}

/* ── Sidebar ─────────────────────────────────────────────────────────────── */

const SECTION_LABEL: Record<string, string> = { favorites: "Favorites", recents: "Recents", pages: "Pages" };

function SidebarSection() {
  const { s, set, ws } = useSettings();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  if (!s) return <Skeleton className="h-40" />;
  const order = s.sidebarSections.filter((id) => id in SECTION_LABEL);
  const move = (from: number, to: number) => to >= 0 && to < order.length && set("sidebarSections", arrayMove(order, from, to), "Sidebar order saved");
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    move(order.indexOf(active.id as never), order.indexOf(over.id as never));
  };
  return (
    <>
      <Heading title="Sidebar" description="Drag the handles to reorder sections. You can also drag them directly in the sidebar." />
      <Group title="Section order">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={order} strategy={verticalListSortingStrategy}>
            <ul className="grid gap-1 py-2">
              {order.map((id, i) => (
                <SortableSection key={id} id={id} label={SECTION_LABEL[id]} onUp={() => move(i, i - 1)} onDown={() => move(i, i + 1)} first={i === 0} last={i === order.length - 1} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      </Group>
      <Group title="Options">
        <SettingRow title="Show Recents" description="Recently opened pages in the sidebar.">
          <Switch label="Show Recents" checked={s.showRecents} onCheckedChange={(v) => set("showRecents", v)} />
        </SettingRow>
        <SettingRow title="Reset sidebar" description="Restore the default section order, width and expanded sections. Your pages don't change.">
          <Button size="sm" onClick={() => ws.call("settings.reset", { scope: "sidebar" }).then(() => toast.success("Sidebar reset")).catch((e) => notifyError(e))}>
            Reset sidebar
          </Button>
        </SettingRow>
      </Group>
    </>
  );
}

function SortableSection({ id, label, onUp, onDown, first, last }: { id: string; label: string; onUp: () => void; onDown: () => void; first: boolean; last: boolean }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} className={cn("flex h-10 items-center gap-2 rounded-lg bg-overlay px-2 shadow-[0_0_0_1px_var(--line)]", isDragging && "z-10 shadow-pop")}>
      <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`Drag to reorder ${label}`} className="grid h-7 w-5 cursor-grab place-items-center text-fg-3 active:cursor-grabbing">
        <GripVertical className="size-4" />
      </button>
      <span className="flex-1 text-[13.5px]">{label}</span>
      <IconButton label={`Move ${label} up`} disabled={first} onClick={onUp}><ArrowUp className="size-3.5" /></IconButton>
      <IconButton label={`Move ${label} down`} disabled={last} onClick={onDown}><ArrowDown className="size-3.5" /></IconButton>
    </li>
  );
}

/* ── Connections (MCP) ───────────────────────────────────────────────────── */

interface Token { _id: string; name: string; prefix: string; createdAt: number; lastUsedAt: number | null }
interface AuditEvent { _id: string; op: string; ok: boolean; code: string | null; at: number }

function Copyable({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-md bg-surface-2 px-3 py-2 font-mono text-[12.5px]" dir="ltr">{value}</code>
      <Button
        size="sm"
        icon={copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        onClick={() => navigator.clipboard.writeText(value).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500))).catch(() => toast.error("Couldn't copy. Select the text and copy it manually."))}
        aria-label={`Copy ${label}`}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

function ConnectionsSection() {
  const { ws } = useSettings();
  const tokens = useOp<{ tokens: Token[] }>("tokens.list", {});
  const audit = useOp<{ events: AuditEvent[] }>("audit.list", { limit: 30 });
  const [name, setName] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const mcpUrl = `${CLOUD ? APP_URL : typeof window !== "undefined" ? window.location.origin : APP_URL}/mcp`;
  const create = async () => {
    try {
      const res = await ws.call<{ secret: string }>("tokens.create", { name: name.trim() || "Assistant" });
      setSecret(res.secret);
      setName("");
    } catch (err) {
      notifyError(err);
    }
  };
  const revoke = async (t: Token) => {
    const ok = await confirmAction({ title: `Revoke “${t.name}”?`, body: <p>Assistants using this token lose access immediately. You can create a new token any time.</p>, confirmLabel: "Revoke token", tone: "danger" });
    if (!ok) return;
    try {
      await ws.call("tokens.revoke", { id: t._id });
      toast.success("Token revoked");
    } catch (err) {
      notifyError(err);
    }
  };
  return (
    <>
      <Heading title="Connections" description="Bring your work into Max and connect assistants to your private workspace." />
      <NotionConnection />
      <Group title="Server address">
        <div className="grid gap-2 py-3">
          <Copyable value={mcpUrl} label="server address" />
          <p className="text-[12.5px] text-fg-3">
            {CLOUD ? "In ChatGPT or Claude, add a custom connector with this address and sign in with your Max account." : "Local mode: connect with an access token below. Sign-in based connections need the cloud setup."}{" "}
            <a href="/connect" target="_blank" className="underline underline-offset-2">Step-by-step guide</a>
          </p>
        </div>
      </Group>
      <Group title="Access tokens">
        <div className="grid gap-3 py-3">
          {secret && (
            <Notice tone="success" title="Copy your new token now" action={<Button size="xs" variant="ghost" onClick={() => setSecret(null)}>Done</Button>}>
              <p className="mb-2">For security it won&apos;t be shown again. Send it as <code className="font-mono">Authorization: Bearer …</code></p>
              <Copyable value={secret} label="token" />
            </Notice>
          )}
          <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), void create())}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Token name, e.g. Claude Desktop" aria-label="Token name" className="max-w-xs" />
            <Button type="submit" variant="primary">Create token</Button>
          </form>
          {!tokens.data ? (
            <Skeleton className="h-10" />
          ) : tokens.data.tokens.length ? (
            <ul className="divide-y divide-line rounded-lg shadow-[0_0_0_1px_var(--line)]">
              {tokens.data.tokens.map((t) => (
                <li key={t._id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-medium">{t.name}</p>
                    <p className="text-[12px] text-fg-3"><span className="font-mono" dir="ltr">{t.prefix}…</span> · created {timeAgo(t.createdAt)} · {t.lastUsedAt ? `last used ${timeAgo(t.lastUsedAt)}` : "never used"}</p>
                  </div>
                  <Button size="sm" variant="ghost" className="text-danger hover:bg-danger-soft hover:text-danger" onClick={() => revoke(t)}>Revoke</Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-fg-3">No tokens yet.</p>
          )}
        </div>
      </Group>
      <Group title="Recent assistant activity">
        {!audit.data ? (
          <Skeleton className="h-10" />
        ) : audit.data.events.length ? (
          <ul className="py-2 text-[13px]">
            {audit.data.events.map((e) => (
              <li key={e._id} className="flex items-center gap-3 py-1">
                <span className={cn("size-1.5 rounded-full", e.ok ? "bg-success" : "bg-danger")} aria-label={e.ok ? "Succeeded" : "Failed"} />
                <code className="font-mono text-[12.5px]">{e.op}</code>
                {!e.ok && <span className="text-[12px] text-danger">{e.code}</span>}
                <span className="ms-auto text-[12px] text-fg-3" title={dateTime(e.at)}>{timeAgo(e.at)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-3 text-[13px] text-fg-3">No assistant has changed anything yet. Only operation names are logged, never your content.</p>
        )}
      </Group>
    </>
  );
}

/* ── Data ────────────────────────────────────────────────────────────────── */

function DataSection() {
  const { ws } = useSettings();
  const read = useRead();
  const assets = useOp<{ totalBytes: number; assets: unknown[] }>("assets.list", {});
  const [busy, setBusy] = useState<string | null>(null);
  const exportAll = async (format: "json" | "markdown") => {
    setBusy(format);
    try {
      const day = new Date().toISOString().slice(0, 10);
      if (format === "json") {
        const res = await read<{ filename: string; content: string }>("export.all", { format: "json" });
        download(res.filename, res.content, "application/json");
      } else {
        const res = await read<{ files: { path: string; content: string }[] }>("export.all", { format: "markdown" });
        const zip = zipSync(Object.fromEntries(res.files.map((f) => [f.path, strToU8(f.content)])));
        const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: "application/zip" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = `max-markdown-${day}.zip`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      toast.success("Export downloaded");
    } catch (err) {
      notifyError(err, "Couldn't export. Try again.");
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <Heading title="Data & export" description="Your workspace belongs to you. Take it with you at any time." />
      <Group title="Export">
        <SettingRow title="Export everything as Markdown" description="A .zip with one Markdown file per page, in folders that match your page tree.">
          <Button size="sm" icon={<Download className="size-3.5" />} pending={busy === "markdown"} onClick={() => exportAll("markdown")}>Export Markdown</Button>
        </SettingRow>
        <SettingRow title="Export a full backup (JSON)" description="Everything, including databases and properties. Can be imported back into Max.">
          <Button size="sm" icon={<Download className="size-3.5" />} pending={busy === "json"} onClick={() => exportAll("json")}>Export JSON</Button>
        </SettingRow>
      </Group>
      <Group title="Import">
        <SettingRow title="Import from Notion, Markdown or a Max backup" description="Notion: Settings → Export → Markdown & CSV, then choose the .zip here.">
          <Button size="sm" icon={<Upload className="size-3.5" />} onClick={() => (ws.closeSettings(), ws.setImportOpen(true))}>Import</Button>
        </SettingRow>
      </Group>
      <Group title="Storage">
        <SettingRow title="Uploaded files" description={assets.data ? `${assets.data.assets.length} file${assets.data.assets.length === 1 ? "" : "s"} · ${bytes(assets.data.totalBytes)}` : "Counting…"}>
          <span />
        </SettingRow>
        <SettingRow title="Trash" description="Pages stay in the trash until you empty it.">
          <Button size="sm" icon={<Trash2 className="size-3.5" />} onClick={() => (ws.closeSettings(), window.location.assign(new URL("/trash", window.location.origin)))}>Open trash</Button>
        </SettingRow>
      </Group>
    </>
  );
}

/* ── Shortcuts & About ───────────────────────────────────────────────────── */

function ShortcutsSection() {
  const groups = [...new Set(SHORTCUTS.map((s) => s.group))];
  return (
    <>
      <Heading title="Keyboard shortcuts" description="Everything in Max works from the keyboard. On Windows and Linux, use Ctrl for ⌘ and Alt for ⌥. Press ⌘/ any time to come back here." />
      {groups.map((g) => (
        <Group key={g} title={g}>
          <dl>
            {SHORTCUTS.filter((s) => s.group === g).map((s) => (
              <div key={s.label} className="flex items-center justify-between gap-4 py-2 text-[13.5px]">
                <dt>{s.label}</dt>
                <dd className="shrink-0"><Kbd className="px-1.5">{s.keys}</Kbd></dd>
              </div>
            ))}
          </dl>
        </Group>
      ))}
    </>
  );
}

function AboutSection() {
  return (
    <>
      <Heading title="About Max" />
      <Group>
        <SettingRow title="Version" description={VERSION}><span /></SettingRow>
        <SettingRow title="Mode" description={CLOUD ? "Cloud: accounts and sync" : "Local: private workspace on this server"}><span /></SettingRow>
        <SettingRow title="Privacy" description="What Max stores and how to delete it."><a className="text-[13px] underline underline-offset-2" href="/privacy" target="_blank">Read</a></SettingRow>
        <SettingRow title="Source code" description="Max is open source under the AGPL-3.0 license."><a className="text-[13px] underline underline-offset-2" href={REPO_URL} target="_blank" rel="noreferrer">GitHub</a></SettingRow>
      </Group>
    </>
  );
}
