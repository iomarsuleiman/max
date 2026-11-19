import { z } from "zod";
import { MaxError } from "../errors";
import { accountOf, MAX_WORKSPACES, ownerFor, workspaceOf, type WorkspaceEntry } from "../workspaces";
import type { SettingsRow } from "../types";
import { confirm, defineOp, type OpContext } from "./define";
import { defaultSettings } from "./helpers";
import { accountDeleteAllData } from "./account";

const name = z.string().trim().min(1, "Give the workspace a name.").max(60);
const icon = z.string().max(64).nullable().optional();

/** The account's settings row, created if this is its first visit. Workspaces are listed on it. */
async function accountRow(ctx: OpContext): Promise<SettingsRow> {
  const account = accountOf(ctx.ownerId);
  const row = (await ctx.db.list("settings", account))[0];
  if (row) return row;
  const fresh = defaultSettings(account, ctx.now);
  const _id = await ctx.db.insert("settings", fresh);
  return { _id, ...fresh } as SettingsRow;
}

async function newId(taken: Set<string>): Promise<string> {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  for (;;) {
    const buf = new Uint8Array(8);
    globalThis.crypto.getRandomValues(buf);
    const id = Array.from(buf, (b) => alphabet[b % alphabet.length]).join("");
    if (!taken.has(id)) return id;
  }
}

export const workspacesList = defineOp({
  name: "workspaces.list",
  kind: "query",
  title: "List workspaces",
  description: "Lists the user's personal workspaces (the main one has id null) and which one this call ran in. Every other tool takes an optional `workspace` (id or name) to work in that workspace; without it, tools use the main workspace.",
  input: z.object({}),
  async run(ctx) {
    const row = (await ctx.db.list("settings", accountOf(ctx.ownerId)))[0];
    return {
      current: workspaceOf(ctx.ownerId),
      workspaces: [
        { id: null as string | null, name: row?.workspaceName?.trim() || "Personal", icon: row?.workspaceIcon ?? null },
        ...(row?.workspaces ?? []).map((w) => ({ id: w.id as string | null, name: w.name, icon: w.icon })),
      ],
    };
  },
});

export const workspacesCreate = defineOp({
  name: "workspaces.create",
  kind: "mutation",
  title: "Create a workspace",
  uiOnly: true,
  description: "Creates a new, empty personal workspace. Its pages, databases and files are separate from your other workspaces.",
  input: z.object({ name, icon }),
  async run(ctx, input) {
    const row = await accountRow(ctx);
    const list = row.workspaces ?? [];
    if (list.length >= MAX_WORKSPACES) throw new MaxError("LIMIT", `You can have up to ${MAX_WORKSPACES + 1} workspaces. Delete one to make another.`);
    const id = await newId(new Set(list.map((w) => w.id)));
    const entry: WorkspaceEntry = { id, name: input.name, icon: input.icon ?? null, createdAt: ctx.now };
    await ctx.db.patch("settings", row._id, { workspaces: [...list, entry], updatedAt: ctx.now });
    return { workspace: { id, name: entry.name, icon: entry.icon } };
  },
});

export const workspacesUpdate = defineOp({
  name: "workspaces.update",
  kind: "mutation",
  title: "Rename a workspace",
  uiOnly: true,
  description: "Changes a workspace's name or icon. `id: null` is your main workspace.",
  input: z.object({ id: z.string().nullable(), name: name.optional(), icon }),
  async run(ctx, { id, name: next, icon: nextIcon }) {
    const row = await accountRow(ctx);
    if (id === null) {
      await ctx.db.patch("settings", row._id, { ...(next !== undefined ? { workspaceName: next } : {}), ...(nextIcon !== undefined ? { workspaceIcon: nextIcon } : {}), updatedAt: ctx.now });
      return { ok: true };
    }
    const list = row.workspaces ?? [];
    if (!list.some((w) => w.id === id)) throw new MaxError("NOT_FOUND", "That workspace doesn't exist.");
    const workspaces = list.map((w) => (w.id === id ? { ...w, ...(next !== undefined ? { name: next } : {}), ...(nextIcon !== undefined ? { icon: nextIcon } : {}) } : w));
    await ctx.db.patch("settings", row._id, { workspaces, updatedAt: ctx.now });
    return { ok: true };
  },
});

export const workspacesDelete = defineOp({
  name: "workspaces.delete",
  kind: "mutation",
  title: "Delete a workspace",
  destructive: true,
  uiOnly: true,
  description: "Permanently deletes an extra workspace and everything in it. Your main workspace can't be deleted this way.",
  input: z.object({ id: z.string(), confirm }),
  async run(ctx, { id }) {
    const row = await accountRow(ctx);
    const list = row.workspaces ?? [];
    if (!list.some((w) => w.id === id)) throw new MaxError("NOT_FOUND", "That workspace doesn't exist.");
    const { removed } = await accountDeleteAllData.run({ ...ctx, ownerId: ownerFor(row.ownerId, id) }, { confirm: true });
    await ctx.db.patch("settings", row._id, { workspaces: list.filter((w) => w.id !== id), updatedAt: ctx.now });
    return { removed };
  },
});
