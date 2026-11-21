"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AtSign, Bell, CalendarClock, CheckCheck, Inbox as InboxIcon, Megaphone, KeyRound, MessageSquare, Settings2, ShieldCheck, UserRoundCheck, Users, Zap } from "@/components/icons";
import { IconButton, Popover, Segmented, Switch, cn } from "@/components/ui";
import { useOp } from "@/lib/client/data";
import { timeAgo } from "@/lib/client/format";
import { pageHref } from "@/lib/pageUrl";
import { activeWorkspace, switchWorkspace } from "@/lib/client/workspace";
import { notifyError, useWorkspace } from "./context";

interface Note {
  _id: string;
  kind: string;
  scope: string | null;
  pageId: string | null;
  actorName: string | null;
  title: string;
  body: string | null;
  readAt: number | null;
  at: number;
}
interface InboxData {
  notifications: Note[];
  unread: number;
  reminders: { pageId: string; title: string; database: string; due: string; overdue: boolean }[];
}

const ICON: Record<string, typeof Bell> = { announcement: Megaphone, mention: AtSign, comment: MessageSquare, assigned: UserRoundCheck, approval: ShieldCheck, access: KeyRound, membership: Users, automation: Zap, reminder: CalendarClock };

/** Which workspace a notification's page lives in, as the browser's `ws` (null: your main one). */
function wsOf(scope: string | null): string | null | undefined {
  if (!scope) return undefined;
  if (scope.startsWith("org_")) return scope;
  return scope.includes("~") ? scope.split("~")[1] : null;
}

/** The sidebar's Inbox row: unread count, and the inbox itself in a panel. */
export function InboxButton() {
  const [open, setOpen] = useState(false);
  const q = useOp<InboxData>("inbox.list", { limit: 60 });
  const unread = (q.data?.unread ?? 0) + (q.data?.reminders.filter((r) => r.overdue).length ?? 0);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      side="right"
      className="w-[min(400px,calc(100vw-24px))] p-0"
      trigger={
        <button type="button" className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13.5px] text-fg-2 hover:bg-hover hover:text-fg" aria-label={unread ? `Inbox, ${unread} unread` : "Inbox"}>
          <InboxIcon className="size-4" aria-hidden />
          <span className="flex-1 text-start">Inbox</span>
          {unread > 0 && <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold tabular-nums text-accent-fg">{unread > 99 ? "99+" : unread}</span>}
        </button>
      }
    >
      {open && <InboxPanel data={q.data} onClose={() => setOpen(false)} />}
    </Popover>
  );
}

function InboxPanel({ data, onClose }: { data: InboxData | undefined; onClose: () => void }) {
  const ws = useWorkspace();
  const router = useRouter();
  const [show, setShow] = useState<"all" | "unread">("all");
  const [prefs, setPrefs] = useState(false);
  const open = async (n: { _id?: string; scope?: string | null; pageId: string | null; title: string }) => {
    if (n._id) void ws.call("inbox.markRead", { ids: [n._id] }).catch(() => undefined);
    onClose();
    if (!n.pageId) return;
    const href = pageHref(n.pageId);
    const target = wsOf(n.scope ?? null);
    if (target !== undefined && target !== activeWorkspace()) switchWorkspace(target, href);
    else router.push(href);
  };
  const list = (data?.notifications ?? []).filter((n) => show === "all" || !n.readAt);
  return (
    <div className="grid max-h-[min(560px,80vh)] grid-rows-[auto_1fr]">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="flex-1 text-[13.5px] font-semibold">Inbox</h2>
        <Segmented label="Show" size="sm" value={show} onChange={(v) => setShow(v as typeof show)} options={[{ value: "all", label: "All" }, { value: "unread", label: "Unread" }]} />
        <IconButton label="Mark all read" size="sm" onClick={() => ws.call("inbox.markRead", { all: true }).catch((e) => notifyError(e))}>
          <CheckCheck className="size-4" />
        </IconButton>
        <IconButton label="Notification settings" size="sm" onClick={() => setPrefs((p) => !p)}>
          <Settings2 className="size-4" />
        </IconButton>
      </div>
      <div className="overflow-y-auto">
        {prefs ? (
          <Preferences />
        ) : (
          <>
            {!!data?.reminders.length && (
              <section aria-label="Due soon" className="border-b border-line px-1 py-1">
                <h3 className="px-2 pb-1 pt-1.5 text-[12px] font-medium text-fg-3">Due soon</h3>
                {data.reminders.map((r) => (
                  <button key={r.pageId} type="button" onClick={() => open({ pageId: r.pageId, title: r.title })} className="flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-start hover:bg-hover">
                    <CalendarClock className={cn("mt-0.5 size-4 shrink-0", r.overdue ? "text-danger" : "text-fg-3")} aria-hidden />
                    <span className="min-w-0 flex-1 text-[13px]">
                      <span className="block truncate font-medium">{r.title}</span>
                      <span className={cn("block text-[12px]", r.overdue ? "text-danger" : "text-fg-3")}>{r.overdue ? "Overdue" : "Due"} {r.due.slice(0, 10)} · {r.database}</span>
                    </span>
                  </button>
                ))}
              </section>
            )}
            {list.length === 0 ? (
              <div className="grid place-items-center gap-1 px-6 py-12 text-center">
                <Bell className="size-5 text-fg-3" aria-hidden />
                <p className="text-[13.5px] font-medium">{show === "unread" ? "You're all caught up" : "Nothing here yet"}</p>
                <p className="text-[12.5px] text-fg-3">Mentions, replies, assignments, reviews and access requests land here.</p>
              </div>
            ) : (
              <ul className="px-1 py-1" aria-label="Notifications">
                {list.map((n) => {
                  const Icon = ICON[n.kind] ?? Bell;
                  return (
                    <li key={n._id}>
                      <button type="button" onClick={() => open(n)} className="flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-start hover:bg-hover">
                        <Icon className="mt-0.5 size-4 shrink-0 text-fg-3" aria-hidden />
                        <span className="min-w-0 flex-1 text-[13px]">
                          <span className={cn("block", !n.readAt && "font-medium")}>{n.title}</span>
                          {n.body && <span className="line-clamp-2 block text-[12.5px] text-fg-2">{n.body}</span>}
                          <span className="block text-[12px] text-fg-3">{timeAgo(n.at)}</span>
                        </span>
                        {!n.readAt && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

type Kind = { kind: string; label: string; hint: string; on: boolean };

function Preferences() {
  const ws = useWorkspace();
  const [kinds, setKinds] = useState<Kind[] | null>(null);
  useEffect(() => {
    let live = true;
    ws.call<{ kinds: Kind[] }>("inbox.preferences", {}).then((r) => live && setKinds(r.kinds), (e) => notifyError(e));
    return () => {
      live = false;
    };
  }, [ws]);
  if (!kinds) return <p className="px-4 py-6 text-[13px] text-fg-3">Loading…</p>;
  return (
    <ul className="divide-y divide-line px-3 py-1" aria-label="Notification settings">
      {kinds.map((k) => (
        <li key={k.kind} className="flex items-center gap-3 py-2.5">
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium">{k.label}</span>
            <span className="block text-[12px] text-fg-3">{k.hint}</span>
          </span>
          <Switch
            checked={k.on}
            label={k.label}
            onCheckedChange={async (on) => {
              try {
                setKinds((await ws.call<{ kinds: Kind[] }>("inbox.preferences", { set: { [k.kind]: on } })).kinds);
              } catch (err) {
                notifyError(err);
              }
            }}
          />
        </li>
      ))}
    </ul>
  );
}
