/**
 * The inbox: one per account, across personal workspaces and organizations.
 *
 * Notifications are written by the server in the same transaction as what caused them, so a
 * rolled-back change never notifies anyone. They respect each person's preferences, skip the
 * person who acted, collapse repeats (same `key` while unread) and keep the newest 500. On read,
 * notifications about organizations you've left are dropped, so nothing lingers after access ends.
 */
import type { Db } from "./db";
import type { NotificationKind, NotificationRow } from "./types";
import { isOrgNamespace, memberOf } from "./organizations";

export const NOTIFICATION_KINDS: { kind: NotificationKind; label: string; hint: string }[] = [
  { kind: "announcement", label: "Announcements", hint: "Your organization's admins announce a page to you" },
  { kind: "mention", label: "Mentions", hint: "Someone @mentions you in a comment" },
  { kind: "comment", label: "Comments", hint: "Replies and new comments on pages you've commented on" },
  { kind: "assigned", label: "Assignments", hint: "You're assigned to a task or record" },
  { kind: "approval", label: "Reviews and approvals", hint: "Review requests, decisions and suggested edits" },
  { kind: "access", label: "Access requests", hint: "Someone asks to join a private page you manage" },
  { kind: "membership", label: "Membership", hint: "Your role in an organization changes" },
  { kind: "automation", label: "Automations", hint: "Notifications sent by database automations" },
  { kind: "reminder", label: "Due dates", hint: "Tasks assigned to you that are due soon or overdue" },
];

const KEEP = 500;

export interface NotifyInput {
  kind: NotificationKind;
  /** The namespace it's about (an organization, or a personal workspace). */
  ownerId: string | null;
  pageId: string | null;
  actor: { id: string; name?: string | null } | null;
  title: string;
  body?: string | null;
  /** Repeats with the same key collapse into one while unread. */
  key?: string | null;
}

export async function notify(db: Db, recipients: Iterable<string>, input: NotifyInput, now: number) {
  let sent = 0;
  for (const to of new Set(recipients)) {
    if (!to || to === "anon" || to === input.actor?.id || isOrgNamespace(to)) continue;
    const settings = (await db.list("settings", to))[0];
    if (settings?.notificationPrefs?.[input.kind] === false) continue;
    const row = {
      ownerId: to,
      kind: input.kind,
      scope: input.ownerId,
      pageId: input.pageId,
      actorId: input.actor?.id ?? null,
      actorName: input.actor?.name?.slice(0, 120) ?? null,
      title: input.title.slice(0, 300),
      body: input.body?.slice(0, 500) ?? null,
      key: input.key ?? null,
      readAt: null,
      at: now,
    };
    const mine = await db.list("notifications", to);
    const same = input.key ? mine.find((n) => n.key === input.key && !n.readAt) : null;
    if (same) await db.patch("notifications", same._id, { title: row.title, body: row.body, actorId: row.actorId, actorName: row.actorName, at: now });
    else {
      await db.insert("notifications", row);
      if (mine.length >= KEEP) for (const old of mine.sort((a, b) => a.at - b.at).slice(0, mine.length - KEEP + 1)) await db.delete("notifications", old._id);
    }
    sent++;
  }
  return sent;
}

/** Your inbox, newest first, without notifications from organizations you're no longer in. */
export async function inbox(db: Db, accountId: string, opts: { unreadOnly?: boolean; limit?: number }) {
  const rows = (await db.list("notifications", accountId)).sort((a, b) => b.at - a.at);
  const orgOk = new Map<string, boolean>();
  const out: NotificationRow[] = [];
  for (const n of rows) {
    if (opts.unreadOnly && n.readAt) continue;
    if (n.scope && isOrgNamespace(n.scope)) {
      if (!orgOk.has(n.scope)) {
        const m = await memberOf(db, n.scope, accountId);
        orgOk.set(n.scope, !!m && m.status === "active");
      }
      if (!orgOk.get(n.scope)) continue;
    }
    out.push(n);
    if (out.length >= Math.min(opts.limit ?? 100, 200)) break;
  }
  return { notifications: out.map(({ ownerId: _o, ...n }) => n), unread: rows.filter((n) => !n.readAt).length };
}

export async function markRead(db: Db, accountId: string, ids: string[] | "all", now: number, read = true) {
  const rows = await db.list("notifications", accountId);
  let changed = 0;
  for (const n of rows) {
    if (ids !== "all" && !ids.includes(n._id)) continue;
    if (!!n.readAt === read) continue;
    await db.patch("notifications", n._id, { readAt: read ? now : null });
    changed++;
  }
  return { changed };
}
