"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Dialog as D } from "radix-ui";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { zipSync, strToU8 } from "fflate";
import { ArrowDown, ArrowUp, Bot, Building2, Plus, Check, Copy, Database, Download, Globe, GripVertical, Info, Keyboard, LogOut, PanelLeft, PenLine, Search as SearchIcon, Settings2, Trash2, Upload, User, Users, UsersRound, X } from "lucide-react";
import { DOODLE, Doodle } from "@/components/icons/Doodle";
import { toast } from "sonner";
import { Button, Field, IconButton, Input, Kbd, Notice, Segmented, Select, SettingRow, Skeleton, Switch, cn, confirmAction } from "@/components/ui";
import { PageIcon } from "@/components/workspace/PageIcon";
import { useLeaveShared, useOp, useRead, useSharing } from "@/lib/client/data";
import { useRouter } from "next/navigation";
import { pageHref, publicHref } from "@/lib/pageUrl";
import { SHARING_ENABLED } from "@/lib/config";
import { bytes, dateTime, pageTitle, timeAgo } from "@/lib/client/format";
import { APP_URL, CLOUD, REPO_URL, VERSION } from "@/lib/config";
import type { SettingsRow } from "@/lib/client/types";
import { Avatar } from "@/components/workspace/Sidebar";
import { notifyError, useWorkspace, type SettingsSection } from "@/components/workspace/context";
import { download } from "@/components/page/PageOptions";
import { SHORTCUTS } from "@/lib/client/shortcuts";
import { NotionConnection } from "./NotionConnection";
import { ProfileCardEditor } from "@/components/profile/ProfileCardEditor";
import { INVITE_NOTE, MAX_NOTE_CHARS, writeNote } from "@/lib/welcomeNote";
import { openSpaceEditor } from "./SpacePanel";
import { ReportDialog } from "@/components/admin/ReportDialog";
import type { SidebarSectionId } from "@/lib/domain/types";
import { NewWorkspaceDialog, WorkspaceIcon, useWorkspaces } from "@/components/workspace/Workspaces";
import { switchWorkspace } from "@/lib/client/workspace";
import { IconPicker } from "@/components/page/IconPicker";

const NAV: { id: SettingsSection; label: string; icon: ReactNode; group: "Account" | "Workspace"; keywords: string }[] = [
  { id: "account", label: "My account", icon: <Doodle icon={User} color={DOODLE.pink} size={15} />, group: "Account", keywords: "name email sign out delete account profile" },
  { id: "preferences", label: "Preferences", icon: <Doodle icon={Settings2} color={DOODLE.amber} size={15} />, group: "Account", keywords: "theme dark light accent color space font density motion date time week clock full width" },
  { id: "editor", label: "Editor", icon: <Doodle icon={PenLine} color={DOODLE.teal} size={15} />, group: "Account", keywords: "text direction spellcheck markdown shortcuts writing rtl arabic" },
  { id: "sidebar", label: "Sidebar", icon: <Doodle icon={PanelLeft} color={DOODLE.violet} size={15} />, group: "Account", keywords: "sections order recents favorites" },
  { id: "workspace", label: "Workspace", icon: <Doodle icon={Building2} color={DOODLE.sage} size={15} />, group: "Workspace", keywords: "workspace name icon personal new delete switch" },
  ...(SHARING_ENABLED
    ? [
        { id: "teamspaces" as const, label: "Teamspaces", icon: <Doodle icon={UsersRound} color={DOODLE.mint} size={15} />, group: "Workspace" as const, keywords: "workspace team members leave join" },
        { id: "sharing" as const, label: "Sharing", icon: <Doodle icon={Users} color={DOODLE.blue} size={15} />, group: "Workspace" as const, keywords: "shared published link people access" },
      ]
    : []),
  { id: "connections", label: "Connections", icon: <Doodle icon={Bot} color={DOODLE.orange} size={15} />, group: "Workspace", keywords: "assistant claude chatgpt mcp token notion import" },
  { id: "data", label: "Data & export", icon: <Doodle icon={Database} color={DOODLE.sage} size={15} />, group: "Workspace", keywords: "export backup download import markdown json delete" },
  { id: "shortcuts", label: "Keyboard shortcuts", icon: <Doodle icon={Keyboard} color={DOODLE.lilac} size={15} />, group: "Workspace", keywords: "keys hotkeys" },
  { id: "about", label: "About Max", icon: <Doodle icon={Info} color={DOODLE.red} size={15} />, group: "Workspace", keywords: "card membership invite friends version privacy source" },
];

export function SettingsDialog() {
  const ws = useWorkspace();
  const section = ws.settingsSection;
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q ? NAV.filter((n) => `${n.label} ${n.keywords}`.toLowerCase().includes(q)) : NAV;
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
          <D.Close asChild><IconButton label="Close settings" size="md" className="absolute end-2 top-2 z-10 bg-overlay md:hidden"><X className="size-5" /></IconButton></D.Close>
          <nav aria-label="Settings sections" className="max-space flex w-60 shrink-0 flex-col gap-0.5 overflow-y-auto px-2 py-3 max-md:w-[calc(100%-3.25rem)] max-md:flex-row max-md:gap-1 max-md:overflow-x-auto max-md:py-2">
            <SettingsSearch value={query} onChange={setQuery} />
            {(["Account", "Workspace"] as const).map((g) => (
              <div key={g} className="contents">
                {shown.some((n) => n.group === g) && <p className="px-2 pb-1 pt-2 text-[11.5px] font-medium text-fg-3 first:pt-0 max-md:hidden">{g}</p>}
                {shown.filter((n) => n.group === g).map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    aria-current={section === n.id ? "page" : undefined}
                    onClick={() => ws.openSettings(n.id)}
                    className={cn("flex h-7 max-md:h-11 shrink-0 items-center gap-2 rounded-md px-2 text-[13.5px] text-fg-2 hover:bg-hover hover:text-fg [&>svg]:size-4 [&>svg]:text-fg-3", section === n.id && "bg-hover font-medium text-fg")}
                  >
                    {n.icon}
                    {n.label}
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <div className="relative min-h-0 min-w-0 flex-1 overflow-y-auto px-12 py-9 max-md:border-t max-md:border-line max-md:px-5 max-md:py-6">
            <D.Close asChild>
              <IconButton label="Close settings" size="md" className="absolute end-3 top-3 max-md:hidden">
                <X className="size-4" />
              </IconButton>
            </D.Close>
            {section === "workspace" && <WorkspaceSection />}
            {section === "account" && <AccountSection />}
            {section === "preferences" && <PreferencesSection />}
            {section === "editor" && <EditorSection />}
            {section === "sidebar" && <SidebarSection />}
            {section === "teamspaces" && <TeamspacesSettings />}
            {section === "sharing" && <SharingSection />}
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

/** A rounded group of settings (Arc-style cards), with its title above. */
function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="mb-7">
      {title && <h3 className="mb-2 px-1 text-[12.5px] font-medium text-fg-3">{title}</h3>}
      <div className="settings-card divide-y divide-line">{children}</div>
    </section>
  );
}

/** Finds a setting: matches section names and what's inside them ("dark", "export", "token"…). */
function SettingsSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="mb-2 flex h-8 shrink-0 items-center gap-2 rounded-lg bg-overlay/70 px-2.5 text-[13px] shadow-[0_0_0_1px_var(--line)] focus-within:shadow-[0_0_0_1.5px_var(--accent)] max-md:hidden">
      <SearchIcon className="size-3.5 text-fg-3" aria-hidden />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Search settings" aria-label="Search settings" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-fg-3" />
    </label>
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
  const { s, ws } = useSettings();
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
          <span className="text-sm font-medium">{s?.displayName || s?.profileCard?.name || id.name}</span>
        </div>
        <UsernameRow />
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
      <Group title="Your name">
        <NameField />
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

const ACCENTS = [
  { value: "blue", label: "Blue", color: "oklch(0.55 0.12 250)" },
  { value: "purple", label: "Purple", color: "oklch(0.55 0.12 300)" },
  { value: "pink", label: "Pink", color: "oklch(0.58 0.14 350)" },
  { value: "red", label: "Red", color: "oklch(0.56 0.16 27)" },
  { value: "orange", label: "Orange", color: "oklch(0.64 0.14 50)" },
  { value: "green", label: "Green", color: "oklch(0.55 0.11 155)" },
  { value: "teal", label: "Teal", color: "oklch(0.56 0.09 195)" },
  { value: "graphite", label: "Graphite", color: "oklch(0.45 0.01 260)" },
];

/** A row of color dots to pick from (Arc-style). */
function Swatches({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string; color: string }[] }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex max-w-[300px] flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          aria-label={o.label}
          title={o.label}
          onClick={() => onChange(o.value)}
          className={cn("size-6 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/.12)] outline-offset-2 transition-transform hover:scale-110", value === o.value && "outline-2 outline-[var(--fg)] [outline-style:solid]")}
          style={{ background: o.color }}
        />
      ))}
    </div>
  );
}

function PreferencesSection() {
  const { s, set, ws } = useSettings();
  if (!s) return <Skeleton className="h-40" />;
  return (
    <>
      <Heading title="Preferences" description="Saved to your account and applied on every device." />
      <Group>
        <SettingRow title="Your space" description="Colors, grain and light or dark, edited over the app so you can see it change.">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              ws.closeSettings();
              openSpaceEditor();
            }}
          >
            Edit space
          </Button>
        </SettingRow>
        <SettingRow title="Window" description="Edge to edge fills the window (the default). Floating puts pages on a rounded card with a little room around it.">
          <Segmented label="Window" value={s.frame ?? "full"} onChange={(v) => set("frame", v, "Saved")} options={[{ value: "full", label: "Edge to edge" }, { value: "floating", label: "Floating" }]} />
        </SettingRow>
      </Group>
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
        <SettingRow title="Accent color" description="Buttons, links, checkboxes and highlights.">
          <Swatches label="Accent color" value={s.accent ?? "blue"} onChange={(v) => set("accent", v as SettingsRow["accent"], "Accent color saved")} options={ACCENTS} />
        </SettingRow>
        <SettingRow title="Sounds" description="A soft crumple when something goes to the trash, and other small sounds.">
          <Switch label="Sounds" checked={s.sounds !== false} onCheckedChange={(v) => set("sounds", v, v ? "Sounds on" : "Sounds off")} />
        </SettingRow>
        <SettingRow title="Reduce motion" description="Turn off animations. “System” follows your device setting.">
          <Segmented label="Reduce motion" value={s.reduceMotion} onChange={(v) => set("reduceMotion", v)} options={[{ value: "system", label: "System" }, { value: "on", label: "Always" }]} />
        </SettingRow>
      </Group>
      <Group title="Date & time">
        <SettingRow title="Date format" description="How dates appear in pages, databases and history.">
          <Select
            label="Date format"
            size="sm"
            value={s.dateFormat ?? "medium"}
            onChange={(v) => set("dateFormat", v as SettingsRow["dateFormat"], "Date format saved")}
            options={[
              { value: "medium", label: "Nov 19, 2026" },
              { value: "us", label: "11/19/2026" },
              { value: "eu", label: "19/11/2026" },
              { value: "iso", label: "2026-11-19" },
            ]}
          />
        </SettingRow>
        <SettingRow title="Clock" description="12-hour (3:30 PM) or 24-hour (15:30).">
          <Segmented label="Clock" value={s.timeFormat ?? "12h"} onChange={(v) => set("timeFormat", v, "Clock saved")} options={[{ value: "12h", label: "12-hour" }, { value: "24h", label: "24-hour" }]} />
        </SettingRow>
        <SettingRow title="First day of the week" description="Where calendar views start each week.">
          <Segmented label="First day of the week" value={s.weekStart ?? "monday"} onChange={(v) => set("weekStart", v, "Saved")} options={[{ value: "monday", label: "Monday" }, { value: "sunday", label: "Sunday" }]} />
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

const SECTION_LABEL: Record<string, string> = { favorites: "Favorites", recents: "Recents", teamspaces: "Teamspaces", shared: "Shared with you", pages: "Private pages" };

function SidebarSection() {
  const { s, set, ws } = useSettings();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  if (!s) return <Skeleton className="h-40" />;
  const order = s.sidebarSections.filter((id) => id in SECTION_LABEL && (SHARING_ENABLED || (id !== "teamspaces" && id !== "shared")));
  const hidden = new Set([...(s.hiddenSections ?? []), ...(s.showRecents === false ? (["recents"] as const) : [])]);
  const show = (id: SidebarSectionId, on: boolean) => {
    const next = on ? [...hidden].filter((h) => h !== id) : [...hidden, id];
    void ws.updateSettings({ hiddenSections: next.filter((h, i, all) => all.indexOf(h) === i) as SidebarSectionId[], ...(id === "recents" ? { showRecents: on } : {}) });
  };
  const move = (from: number, to: number) => to >= 0 && to < order.length && set("sidebarSections", arrayMove(order, from, to), "Sidebar order saved");
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    move(order.indexOf(active.id as never), order.indexOf(over.id as never));
  };
  return (
    <>
      <Heading title="Sidebar" description="Turn sections on or off and drag them into the order you like. You can also drag them in the sidebar itself." />
      <Group title="Sections">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={order} strategy={verticalListSortingStrategy}>
            <ul className="grid gap-1 py-2">
              {order.map((id, i) => (
                <SortableSection key={id} id={id} label={SECTION_LABEL[id]} shown={!hidden.has(id)} onShow={(on) => show(id, on)} onUp={() => move(i, i - 1)} onDown={() => move(i, i + 1)} first={i === 0} last={i === order.length - 1} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      </Group>
      <Group title="Options">
        <SettingRow title="Reset sidebar" description="Restore the default section order, width and expanded sections. Your pages don't change.">
          <Button size="sm" onClick={() => ws.call("settings.reset", { scope: "sidebar" }).then(() => toast.success("Sidebar reset")).catch((e) => notifyError(e))}>
            Reset sidebar
          </Button>
        </SettingRow>
      </Group>
    </>
  );
}

function SortableSection({ id, label, shown, onShow, onUp, onDown, first, last }: { id: string; label: string; shown: boolean; onShow: (on: boolean) => void; onUp: () => void; onDown: () => void; first: boolean; last: boolean }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} className={cn("flex h-10 items-center gap-2 rounded-lg bg-overlay px-2 shadow-[0_0_0_1px_var(--line)]", isDragging && "z-10 shadow-pop")}>
      <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`Drag to reorder ${label}`} className="grid h-7 w-5 cursor-grab place-items-center text-fg-3 active:cursor-grabbing">
        <GripVertical className="size-4" />
      </button>
      <span className={cn("flex-1 text-[13.5px]", !shown && "text-fg-3")}>{label}</span>
      <Switch label={`Show ${label}`} checked={shown} onCheckedChange={onShow} />
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
    <div className="flex w-full min-w-0 items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-md bg-surface-2 px-3 py-2 font-mono text-[12.5px]" dir="ltr" title={value}>{value.replace(/^https?:\/\//, "")}</code>
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

const ACCESS: Record<string, string> = { full_access: "Full access", edit: "Can edit", comment: "Can comment", view: "Can view" };

interface SharedPage {
  _id: string;
  title: string;
  icon: string | null;
  kind: string;
  people: { name: string | null; email: string | null; image: string | null; level: string }[];
  link: { level: string; public: boolean; token: string } | null;
}

/** Teamspaces you own (with their members) and teamspaces you're in (with a way to leave). */
function TeamspacesSettings() {
  const ws = useWorkspace();
  const router = useRouter();
  const mine = useOp<{ pages: SharedPage[] }>("shares.overview", {});
  const withMe = useSharing<{ _id: string; title: string; icon: string | null; kind: string; level: string; ownerName: string | null; teamspace?: boolean }[]>("withMe", {});
  const leave = useLeaveShared();
  const ownTeams = (ws.tree ?? []).filter((p) => p.teamspace && !p.parentId);
  const members = new Map((mine.data?.pages ?? []).map((p) => [p._id, p.people.length]));
  const theirs = (withMe.data ?? []).filter((p) => p.teamspace);
  const open = (id: string, title: string) => {
    ws.closeSettings();
    router.push(pageHref(id, title));
  };
  const row = "flex min-h-12 items-center gap-3 py-2";
  return (
    <>
      <Heading title="Teamspaces" description="Shared spaces for a group. Everyone in a teamspace can open, edit and add pages to everything inside it." />
      <Group title="Your teamspaces">
        {ownTeams.length === 0 ? (
          <p className="py-3 text-[13px] text-fg-3">You haven&apos;t made a teamspace yet. Use ＋ next to Teamspaces in the sidebar, or turn a top-level page into one from its ⋯ menu.</p>
        ) : (
          ownTeams.map((p) => (
            <div key={p._id} className={row}>
              <PageIcon icon={p.icon} kind={p.kind} size={18} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] text-fg">{pageTitle(p.title)}</p>
                <p className="text-[12px] text-fg-3">{members.get(p._id) ? `${members.get(p._id)} ${members.get(p._id) === 1 ? "member" : "members"} besides you` : "Only you so far"}</p>
              </div>
              <Button size="sm" variant="secondary" onClick={() => open(p._id, p.title)}>
                Manage
              </Button>
            </div>
          ))
        )}
      </Group>
      <Group title="Teamspaces you're in">
        {!withMe.data ? (
          <Skeleton className="my-3 h-10" />
        ) : theirs.length === 0 ? (
          <p className="py-3 text-[13px] text-fg-3">When someone adds you to a teamspace, or you join one through its invite link, it shows up here.</p>
        ) : (
          theirs.map((p) => (
            <div key={p._id} className={row}>
              <PageIcon icon={p.icon} kind={p.kind} size={18} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] text-fg">{pageTitle(p.title)}</p>
                <p className="truncate text-[12px] text-fg-3">{[p.ownerName ? `From ${p.ownerName}` : null, ACCESS[p.level]].filter(Boolean).join(" · ")}</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => open(p._id, p.title)}>
                Open
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-danger hover:bg-danger-soft"
                onClick={async () => {
                  const ok = await confirmAction({ title: `Leave “${pageTitle(p.title)}”?`, body: <p>It leaves your sidebar. Someone in it can add you again, or you can rejoin through its invite link.</p>, confirmLabel: "Leave teamspace", tone: "danger" });
                  if (!ok) return;
                  try {
                    await leave(p._id);
                    toast.success(`Left ${pageTitle(p.title)}`);
                  } catch (err) {
                    notifyError(err, "Couldn't leave the teamspace.");
                  }
                }}
              >
                Leave
              </Button>
            </div>
          ))
        )}
      </Group>
    </>
  );
}

/** Everything you share, everything shared with you, and what's published, in one place. */
function SharingSection() {
  const ws = useWorkspace();
  const router = useRouter();
  const mine = useOp<{ pages: SharedPage[] }>("shares.overview", {});
  const withMe = useSharing<{ _id: string; title: string; icon: string | null; kind: string; level: string; ownerName: string | null }[]>("withMe", {});
  const open = (id: string, title: string) => {
    ws.closeSettings();
    router.push(pageHref(id, title));
  };
  const published = mine.data?.pages.filter((p) => p.link?.public) ?? [];
  const row = "flex min-h-12 items-center gap-3 py-2";
  return (
    <>
      <Heading title="Sharing" description="Pages you share and pages shared with you. Change who has access from a page's Share menu." />
      <Group title="Pages you share">
        {!mine.data ? (
          <Skeleton className="my-3 h-10" />
        ) : mine.data.pages.length === 0 ? (
          <p className="py-3 text-[13px] text-fg-3">You haven&apos;t shared any pages. Open a page and choose Share at the top.</p>
        ) : (
          mine.data.pages.map((p) => (
            <div key={p._id} className={row}>
              <PageIcon icon={p.icon} kind={p.kind} size={18} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] text-fg">{pageTitle(p.title)}</p>
                <p className="truncate text-[12px] text-fg-3">
                  {[
                    p.people.length ? `${p.people.length} ${p.people.length === 1 ? "person" : "people"}: ${p.people.map((x) => x.name || x.email || "Someone").slice(0, 3).join(", ")}${p.people.length > 3 ? "…" : ""}` : null,
                    p.link ? (p.link.public ? "Published to the web" : `Anyone in Max with the link (${(ACCESS[p.link.level] ?? "").toLowerCase()})`) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <Button size="sm" variant="secondary" onClick={() => open(p._id, p.title)}>
                Manage
              </Button>
            </div>
          ))
        )}
      </Group>
      <Group title="Published to the web">
        {published.length === 0 ? (
          <p className="py-3 text-[13px] text-fg-3">Nothing is published. Open a page’s Share menu and choose Publish.</p>
        ) : (
          published.map((p) => (
            <div key={p._id} className={row}>
              <Globe className="size-4 shrink-0 text-fg-3" aria-hidden />
              <p className="min-w-0 flex-1 truncate text-[13.5px] text-fg">{pageTitle(p.title)}</p>
              <Copyable value={`${typeof window === "undefined" ? APP_URL : window.location.origin}${publicHref(p.link!.token, p._id, p.title)}`} label={`public link to ${pageTitle(p.title)}`} />
            </div>
          ))
        )}
      </Group>
      <Group title="Shared with you">
        {!withMe.data ? (
          <Skeleton className="my-3 h-10" />
        ) : withMe.data.length === 0 ? (
          <p className="py-3 text-[13px] text-fg-3">Nothing has been shared with you yet. Pages people share with you also appear under Shared in the sidebar.</p>
        ) : (
          withMe.data.map((p) => (
            <div key={p._id} className={row}>
              <PageIcon icon={p.icon} kind={p.kind} size={18} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] text-fg">{pageTitle(p.title)}</p>
                <p className="truncate text-[12px] text-fg-3">{[p.ownerName ? `From ${p.ownerName}` : null, ACCESS[p.level]].filter(Boolean).join(" · ")}</p>
              </div>
              <Button size="sm" variant="secondary" onClick={() => open(p._id, p.title)}>
                Open
              </Button>
            </div>
          ))
        )}
      </Group>
    </>
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
                <span role="img" className={cn("size-1.5 rounded-full", e.ok ? "bg-success" : "bg-danger")} aria-label={e.ok ? "Succeeded" : "Failed"} />
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

/** Your name, used on your card, in shared pages and throughout Max. Saves when you leave the field. */
function NameField() {
  const { s, ws } = useSettings();
  const current = s?.displayName || ws.identity.name || "";
  const [value, setValue] = useState(current);
  useEffect(() => setValue(current), [current]);
  const save = async () => {
    const name = value.trim();
    if (!name || name === current) return setValue(current);
    try {
      await ws.call("settings.update", { displayName: name });
      toast.success("Name saved", { duration: 1500 });
    } catch (err) {
      notifyError(err, "Couldn't save your name.");
    }
  };
  return (
    <div className="grid gap-1.5 py-3">
      <Input aria-label="Name" value={value} maxLength={80} dir="auto" onChange={(e) => setValue(e.target.value)} onBlur={() => void save()} onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()} />
      <p className="text-[12.5px] text-fg-3">Shown on your card, in pages you share and throughout Max.</p>
    </div>
  );
}

/** Your note for the people you invite, and the link that invites them. */
/** Your username: max.chaos.fail/<username> is your invite link. */
function UsernameRow() {
  const ws = useWorkspace();
  const q = useOp<{ username: string | null }>("account.username", {});
  const current = q.data?.username ?? "";
  const [value, setValue] = useState(current);
  useEffect(() => setValue(current), [current]);
  const host = (typeof window === "undefined" ? APP_URL : window.location.origin).replace(/^https?:\/\//, "");
  const save = async () => {
    const next = value.trim().toLowerCase();
    if (!next || next === current) return setValue(current);
    try {
      await ws.call("account.setUsername", { username: next });
      toast.success(`You're ${host}/${next}`, { duration: 2000 });
    } catch (err) {
      notifyError(err, "Couldn't change your username.");
      setValue(current);
    }
  };
  return (
    <SettingRow title="Username" description="Your invite link. Letters, numbers, dots and underscores.">
      <label className="flex h-8 items-center rounded-md bg-overlay ps-2.5 text-[13px] shadow-[0_0_0_1px_var(--line)] focus-within:shadow-[0_0_0_1px_var(--accent)]" dir="ltr">
        <span className="text-fg-3">{host}/</span>
        <input
          aria-label="Username"
          value={value}
          maxLength={20}
          spellCheck={false}
          autoCapitalize="none"
          onChange={(e) => setValue(e.target.value.toLowerCase().replace(/[^a-z0-9._]/g, ""))}
          onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
          onBlur={() => void save()}
          className="h-full w-32 bg-transparent pe-2.5 text-fg outline-none"
        />
      </label>
    </SettingRow>
  );
}

function InviteFriends() {
  const { s, ws } = useSettings();
  const info = useOp<{ memberNumber: number | null; username: string | null }>("profileCard.get", {});
  const current = s?.inviteNote ?? "";
  const [note, setNote] = useState(current);
  useEffect(() => setNote(current), [current]);
  const save = async () => {
    if (note.trim() === current.trim()) return;
    try {
      await ws.call("settings.update", { inviteNote: note.trim() || null });
      toast.success("Note saved", { duration: 1500 });
    } catch (err) {
      notifyError(err, "Couldn't save your note.");
    }
  };
  const origin = typeof window === "undefined" ? APP_URL : window.location.origin;
  return (
    <>
      <div className="grid gap-1.5 py-3">
        <label htmlFor="invite-note" className="text-[13.5px] font-medium text-fg">Your note for people you invite</label>
        <textarea
          id="invite-note"
          value={note}
          maxLength={MAX_NOTE_CHARS}
          rows={4}
          dir="auto"
          placeholder={writeNote(INVITE_NOTE, "{name}").replace("{name}", "Sam")}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => void save()}
          className="card-hand min-h-[96px] w-full resize-y rounded-md bg-overlay px-3 py-2 text-[20px] leading-snug text-[#26407a] shadow-[0_0_0_1px_var(--line)] outline-none focus:shadow-[0_0_0_1px_var(--accent)] dark:text-[#a9bdf0]"
        />
        <p className="text-[12.5px] text-fg-3">It&apos;s handwritten on the back of their card when they join through your link. Start with {"{name}"} to greet them by name. Leave it empty to send Max&apos;s note, signed by you.</p>
      </div>
      {(info.data?.username || info.data?.memberNumber) && (
        <div className="grid min-w-0 gap-1.5 py-3">
          <p className="text-[13.5px] font-medium text-fg">Your invite link</p>
          <Copyable value={info.data.username ? `${origin}/${info.data.username}` : `${origin}/join?from=${info.data.memberNumber}`} label="invite link" />
        </div>
      )}
    </>
  );
}

function ReportButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Report
      </Button>
      {open && <ReportDialog open={open} onOpenChange={setOpen} />}
    </>
  );
}

/** The workspace that's open: its name and icon, other workspaces, and deleting an extra one. */
function WorkspaceSection() {
  const ws = useWorkspace();
  const spaces = useWorkspaces();
  const here = spaces.current;
  const [name, setName] = useState(here?.name ?? "");
  const [creating, setCreating] = useState(false);
  useEffect(() => setName(here?.name ?? ""), [here?.name]);
  if (spaces.loading || !here) return <Skeleton className="h-40" />;
  const save = (patch: { name?: string; icon?: string | null }, message = "Saved") =>
    ws.call("workspaces.update", { id: here.id, ...patch }).then(() => toast.success(message, { duration: 1500 }), (err) => notifyError(err));
  return (
    <>
      <Heading title="Workspace" description="Each workspace is private and separate: its own pages, databases, files, sidebar and colors. Your name, card and preferences go with you." />
      <Group>
        <SettingRow title="Icon" description="Shown in the sidebar and the workspace menu.">
          <IconPicker
            pageId={null}
            onPick={(icon) => void save({ icon }, "Icon saved")}
            onRemove={() => void save({ icon: null }, "Icon removed")}
            trigger={
              <button type="button" aria-label="Workspace icon" className="grid size-9 place-items-center rounded-lg bg-surface-2 shadow-[inset_0_0_0_1px_var(--line)] hover:bg-hover">
                <WorkspaceIcon workspace={here} size={20} />
              </button>
            }
          />
        </SettingRow>
        <SettingRow title="Name" description="Press Enter to save.">
          <Input
            aria-label="Workspace name"
            className="w-56"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && name.trim() && name.trim() !== here.name && void save({ name: name.trim() }, "Workspace renamed")}
            onBlur={() => name.trim() && name.trim() !== here.name && void save({ name: name.trim() }, "Workspace renamed")}
          />
        </SettingRow>
      </Group>
      <Group title="Your workspaces">
        {spaces.list.map((w) => (
          <SettingRow key={w.id ?? "main"} title={<span className="flex items-center gap-2"><WorkspaceIcon workspace={w} size={16} />{w.name}</span>} description={w.id === null ? "Main workspace" : undefined}>
            {w.id === here.id ? (
              <span className="text-[12.5px] text-fg-3">Open</span>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => switchWorkspace(w.id)}>
                Open
              </Button>
            )}
          </SettingRow>
        ))}
        <div className="py-3">
          <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setCreating(true)}>
            New workspace
          </Button>
        </div>
      </Group>
      {here.id !== null && (
        <Group title="Danger zone">
          <SettingRow title="Delete this workspace" description="Deletes every page, database and file in it, for good.">
            <Button
              size="sm"
              variant="danger"
              onClick={async () => {
                const ok = await confirmAction({ title: `Delete ${here.name}?`, body: <p>Everything in this workspace is deleted permanently. Your other workspaces aren&apos;t affected.</p>, confirmLabel: "Delete workspace", tone: "danger", typeToConfirm: here.name });
                if (!ok) return;
                try {
                  await ws.call("workspaces.delete", { id: here.id, confirm: true });
                  switchWorkspace(null);
                } catch (err) {
                  notifyError(err, "Couldn't delete the workspace.");
                }
              }}
            >
              Delete
            </Button>
          </SettingRow>
        </Group>
      )}
      {creating && <NewWorkspaceDialog open={creating} onOpenChange={setCreating} />}
    </>
  );
}

function AboutSection() {
  const { s } = useSettings();
  return (
    <>
      <Heading title="About Max" description="A calm, private home for your notes, pages and databases." />
      <div className="mb-6">{s ? <ProfileCardEditor /> : <Skeleton className="h-64" />}</div>
      <Group title="Invite friends">
        <InviteFriends />
      </Group>
      <Group>
        <SettingRow title="Version" description={VERSION}><span /></SettingRow>
        <SettingRow title="Mode" description={CLOUD ? "Cloud: accounts and sync" : "Local: private workspace on this server"}><span /></SettingRow>
        <SettingRow title="Report a problem" description="Something broken, or something that shouldn't be here? Tell the people who run Max.">
          <ReportButton />
        </SettingRow>
        <SettingRow title="Privacy" description="What Max stores and how to delete it."><a className="text-[13px] underline underline-offset-2" href="/privacy" target="_blank">Read</a></SettingRow>
        <SettingRow title="Source code" description="Max is open source under the AGPL-3.0 license."><a className="text-[13px] underline underline-offset-2" href={REPO_URL} target="_blank" rel="noreferrer">GitHub</a></SettingRow>
      </Group>
    </>
  );
}
