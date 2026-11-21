import { z } from "zod";
import { accountOf } from "../workspaces";
import { isOrgNamespace } from "../organizations";
import { inbox, markRead, NOTIFICATION_KINDS } from "../notifications";
import { dueReminders } from "../reminders";
import type { NotificationKind } from "../types";
import { defineOp, id, type OpContext } from "./define";
import { getSettingsRow, upsertSettings } from "./helpers";

/** The inbox belongs to the person, whichever workspace or organization the call runs in. */
const me = (ctx: OpContext) => (isOrgNamespace(ctx.ownerId) ? (ctx.actor?.id ?? "") : accountOf(ctx.ownerId));

export const inboxList = defineOp({
  name: "inbox.list",
  kind: "query",
  title: "List inbox",
  description: "Your notifications across workspaces and organizations, newest first (mentions, comments, assignments, reviews, access requests, membership, automations), plus tasks assigned to you in this workspace that are due soon or overdue.",
  input: z.object({ unreadOnly: z.boolean().optional(), limit: z.number().int().min(1).max(200).optional() }),
  async run(ctx, input) {
    const settings = await getSettingsRow(ctx);
    const reminders = settings?.notificationPrefs?.reminder === false ? [] : await dueReminders(ctx, me(ctx));
    return { ...(await inbox(ctx.db, me(ctx), input)), reminders };
  },
});

export const inboxMarkRead = defineOp({
  name: "inbox.markRead",
  kind: "mutation",
  title: "Mark notifications read",
  description: "Marks notifications read (or unread with read: false). Pass ids, or all: true.",
  input: z.object({ ids: z.array(id).max(200).optional(), all: z.boolean().optional(), read: z.boolean().optional() }),
  async run(ctx, { ids, all, read = true }) {
    return markRead(ctx.db, me(ctx), all ? "all" : (ids ?? []), ctx.now, read);
  },
});

export const inboxPreferences = defineOp({
  name: "inbox.preferences",
  kind: "mutation",
  title: "Notification preferences",
  description: "Turns kinds of notifications on or off. Returns every kind with its current state.",
  input: z.object({ set: z.record(z.string(), z.boolean()).optional() }),
  async run(ctx, { set }) {
    const settings = await getSettingsRow(ctx);
    const prefs = { ...(settings?.notificationPrefs ?? {}) };
    for (const [k, v] of Object.entries(set ?? {})) if (NOTIFICATION_KINDS.some((x) => x.kind === k)) prefs[k as NotificationKind] = v;
    if (set) await upsertSettings(ctx, { notificationPrefs: prefs });
    return { kinds: NOTIFICATION_KINDS.map((k) => ({ ...k, on: prefs[k.kind] !== false })) };
  },
});
