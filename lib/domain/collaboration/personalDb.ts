import type { Db, IndexedField, NewRow } from "../db";
import { MaxError, notFound } from "../errors";
import type { TableName, Tables } from "../types";

const CONTENT_TABLES = ["pages", "documents", "assets", "comments", "versions"] satisfies readonly TableName[];
type ContentTable = (typeof CONTENT_TABLES)[number];
const isContentTable = (table: TableName): table is ContentTable =>
  table === "pages" || table === "documents" || table === "assets" || table === "comments" || table === "versions";
const MAX_ANCESTRY = 100;

export interface PersonalDb extends Db {
  /** Run before account deletion, inside the same transaction, before any file removal. */
  preflightAccountDeletion(): Promise<void>;
}

/**
 * Defense for the LEGACY personal dispatcher, never a shared-workspace adapter.
 * ownerId and optional canonical personalWorkspaceId come from verified server
 * metadata. Do not pass a requested workspace or another author's ownerId here.
 *
 * The raw store and this facade must share the eventual operation transaction.
 * No scope decisions survive a read or write. Account/credential rows retain
 * their existing semantics except idempotency receipts. Before returning a
 * cached receipt, this facade conservatively refuses mixed/shared/unresolved
 * content anywhere in the actor's raw content rows. Scoped receipts can replace
 * this account-wide replay restriction when the dispatcher can reauthorize them.
 *
 * Unscoped roots and null-page assets remain personal. A missing/foreign/cyclic
 * parent is unresolved, so its page/children are hidden and cannot be mutated.
 * Such orphan rows are preserved in the raw store for backup/operator recovery.
 * They make account-deletion preflight fail rather than being silently skipped
 * or removed. This stricter behavior deliberately favors recovery over cleanup.
 *
 * Storage-reference closure across other owners requires a separate storage
 * authority; Db.list is owner-scoped and cannot prove global blob exclusivity.
 */
export function createPersonalDb(input: { db: Db; ownerId: string; personalWorkspaceId?: string }): PersonalDb {
  const { db, ownerId, personalWorkspaceId } = input;
  if (!ownerId || (personalWorkspaceId !== undefined && !personalWorkspaceId)) throw new MaxError("INTERNAL", "Personal workspace scope is unavailable.");

  function ownedScope(row: { ownerId: string }): boolean {
    if (row.ownerId !== ownerId) return false;
    if ("workspaceId" in row && row.workspaceId !== undefined) {
      if (typeof row.workspaceId !== "string" || personalWorkspaceId === undefined || row.workspaceId !== personalWorkspaceId) return false;
    }
    // Teamspaces never belong to a personal workspace, even if its workspace
    // marker is missing during additive migration.
    if ("teamspaceId" in row && row.teamspaceId !== undefined && row.teamspaceId !== null) return false;
    return true;
  }

  async function linkedPage(pageId: string, visited: ReadonlySet<string>, depth: number): Promise<boolean> {
    if (!pageId || visited.has(pageId) || depth >= MAX_ANCESTRY) return false;
    const page = await db.get("pages", pageId);
    if (!page || page._id !== pageId || !ownedScope(page)) return false;
    const next = new Set(visited).add(pageId);
    return linkedParents(page.parentId, page.databaseId, next, depth + 1);
  }

  async function linkedParents(parentId: unknown, databaseId: unknown, visited: ReadonlySet<string>, depth: number): Promise<boolean> {
    if (parentId !== null && typeof parentId !== "string") return false;
    if (databaseId !== null && typeof databaseId !== "string") return false;
    if (parentId !== null && !(await linkedPage(parentId, visited, depth))) return false;
    if (databaseId !== null && !(await linkedPage(databaseId, visited, depth))) return false;
    return true;
  }

  async function permitted(table: ContentTable, row: { ownerId: string }): Promise<boolean> {
    if (!ownedScope(row)) return false;
    if (table === "pages") {
      if (!("parentId" in row) || !("databaseId" in row)) return false;
      const visited = new Set<string>();
      if ("_id" in row && typeof row._id === "string") visited.add(row._id);
      return linkedParents(row.parentId, row.databaseId, visited, 1);
    }
    if (!("pageId" in row)) return false;
    if (row.pageId === null) return table === "assets";
    if (typeof row.pageId !== "string") return false;
    return linkedPage(row.pageId, new Set(), 0);
  }

  async function assertEntirePersonalContent(message: string): Promise<void> {
    for (const table of CONTENT_TABLES) {
      for (const row of await db.list(table, ownerId)) {
        if (!(await permitted(table, row))) throw new MaxError("CONFLICT", message);
      }
    }
  }

  const preflightReplay = () =>
    assertEntirePersonalContent(
      "Cached operation replay is unavailable while content has shared or unresolved workspace scope. Reload the authorized content and start a new operation.",
    );

  return {
    async get<T extends TableName>(table: T, id: string): Promise<Tables[T] | null> {
      const row = await db.get(table, id);
      if (table === "idempotency" && row) await preflightReplay();
      if (!row || !isContentTable(table)) return row;
      return row._id === id && (await permitted(table, row)) ? row : null;
    },
    async list<T extends TableName>(table: T, requestedOwnerId: string, where?: { field: IndexedField<T>; value: string | null }): Promise<Tables[T][]> {
      if (!isContentTable(table)) {
        const rows = await db.list(table, requestedOwnerId, where);
        if (table === "idempotency" && rows.length > 0) await preflightReplay();
        return rows;
      }
      if (requestedOwnerId !== ownerId) return [];
      const rows = await db.list(table, ownerId, where);
      const visible: Tables[T][] = [];
      for (const row of rows) if (await permitted(table, row)) visible.push(row);
      return visible;
    },
    async insert<T extends TableName>(table: T, row: NewRow<T>): Promise<string> {
      if (isContentTable(table) && !(await permitted(table, row))) throw notFound();
      return db.insert(table, row);
    },
    async patch<T extends TableName>(table: T, id: string, patch: Partial<NewRow<T>>): Promise<void> {
      if (isContentTable(table)) {
        const row = await db.get(table, id);
        if (!row || row._id !== id || !(await permitted(table, row))) throw notFound();
        // Db.patch ignores undefined. Evaluate exactly that effective next row,
        // rather than allowing undefined to hide an existing workspace marker.
        const changes = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
        if (!(await permitted(table, { ...row, ...changes }))) throw notFound();
      }
      await db.patch(table, id, patch);
    },
    async delete(table: TableName, id: string): Promise<void> {
      if (isContentTable(table)) {
        const row = await db.get(table, id);
        if (!row || row._id !== id || !(await permitted(table, row))) throw notFound();
      }
      await db.delete(table, id);
    },
    findTokenByHash: (hash) => db.findTokenByHash(hash),
    async preflightAccountDeletion(): Promise<void> {
      await assertEntirePersonalContent(
        "Account deletion is unavailable while content has shared or unresolved workspace scope. Preserve a full backup and resolve its scope first.",
      );
    },
  };
}
