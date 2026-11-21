import { MaxError } from "./errors";
import type { Db } from "./db";
import type { OrgRole, SettingsRow } from "./types";
import { isOrgNamespace, ORG_PREFIX, orgAccess, organizationsEnabled } from "./organizations";

/**
 * Personal workspaces. Everyone has a main workspace whose data lives under their account id.
 * Each extra workspace is its own private namespace, `<account>~<id>`: pages, databases, files
 * and sites never mix between them. Because the namespace always starts with the signed-in
 * account, a request can only ever reach that person's own workspaces.
 *
 * The list of workspaces, and each one's own sidebar and space settings, live on the account's
 * settings row, so member numbers (which count settings rows) never change.
 */

export const WS_SEP = "~";
export const WORKSPACE_ID = /^[a-z0-9]{8}$/;
export const MAX_WORKSPACES = 10;

export interface WorkspaceEntry {
  id: string;
  name: string;
  icon: string | null;
  createdAt: number;
  /** This workspace's own sidebar and space settings. */
  prefs?: Partial<SettingsRow>;
}

/** Settings that belong to a workspace; everything else (name, theme, card, dates…) is the account's. */
export const WORKSPACE_FIELDS = ["sidebarSections", "collapsedSections", "expandedPageIds", "lastPageId", "space", "spaceColor", "defaultFullWidth", "showRecents", "sidebarWidth"] as const;
export type WorkspaceField = (typeof WORKSPACE_FIELDS)[number];

export function accountOf(ownerId: string): string {
  const i = ownerId.indexOf(WS_SEP);
  return i < 0 ? ownerId : ownerId.slice(0, i);
}

export function workspaceOf(ownerId: string): string | null {
  const i = ownerId.indexOf(WS_SEP);
  return i < 0 ? null : ownerId.slice(i + 1);
}

export const ownerFor = (account: string, workspace: string | null | undefined) => (workspace ? `${account}${WS_SEP}${workspace}` : account);

/** Which namespace a signed-in account's request acts in. Unknown or deleted workspaces are refused. */
export async function resolveOwner(db: Db, account: string, workspace: unknown): Promise<string> {
  if (workspace === undefined || workspace === null || workspace === "") return account;
  if (typeof workspace !== "string" || !WORKSPACE_ID.test(workspace)) throw new MaxError("NOT_FOUND", "That workspace doesn't exist.", { workspace: "missing" });
  const row = (await db.list("settings", account))[0];
  if (!row?.workspaces?.some((w) => w.id === workspace)) throw new MaxError("NOT_FOUND", "That workspace doesn't exist anymore.", { workspace: "missing" });
  return ownerFor(account, workspace);
}

/** Where a request acts, and as what: a personal namespace, or an organization the caller belongs to. */
export interface RequestScope {
  ownerId: string;
  org?: { role: OrgRole; name: string | null };
}

/**
 * Resolves the `ws` a request asked for. Organizations (`org_…`) are open only to their active,
 * non-guest members; anyone else gets the same "missing workspace" answer as a deleted one, so
 * an organization's existence never leaks.
 */
export async function resolveScope(db: Db, account: string, workspace: unknown): Promise<RequestScope> {
  if (typeof workspace === "string" && workspace.startsWith(ORG_PREFIX)) {
    const access = organizationsEnabled() && isOrgNamespace(workspace) ? await orgAccess(db, account, workspace) : null;
    if (!access) throw new MaxError("NOT_FOUND", "That organization doesn't exist, or you're no longer a member.", { workspace: "missing" });
    return { ownerId: workspace, org: { role: access.member.role, name: access.member.name } };
  }
  return { ownerId: await resolveOwner(db, account, workspace) };
}
