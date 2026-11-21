import type { TableName, Tables } from "./types";

export type NewRow<T extends TableName> = Omit<Tables[T], "_id">;

/**
 * The minimal persistence contract used by every operation. Implemented by the
 * Convex adapter (production) and the file/memory adapter (local development, tests).
 * Ownership is enforced by the operations, never by callers.
 */
export interface Db {
  get<T extends TableName>(table: T, id: string): Promise<Tables[T] | null>;
  /** Rows owned by `ownerId`, optionally narrowed by one indexed equality. */
  list<T extends TableName>(
    table: T,
    ownerId: string,
    where?: { field: IndexedField<T>; value: string | null },
  ): Promise<Tables[T][]>;
  insert<T extends TableName>(table: T, row: NewRow<T>): Promise<string>;
  patch<T extends TableName>(table: T, id: string, patch: Partial<NewRow<T>>): Promise<void>;
  delete(table: TableName, id: string): Promise<void>;
  /** Unscoped lookup used only for credential resolution (token hash). */
  findTokenByHash(hash: string): Promise<Tables["tokens"] | null>;
  /**
   * Cross-account lookup for sharing only: shares by grantee or page, links by token or page,
   * presence by page. Callers must check access before returning anything to a user.
   */
  findBy<T extends CrossTable>(table: T, field: CrossField<T>, value: string): Promise<Tables[T][]>;
  /** A live room's updates after `afterSeq`, oldest first (lib/domain/collab.ts). */
  updatesAfter(roomId: string, afterSeq: number, limit: number): Promise<Tables["collabUpdates"][]>;
  /** Your place in line among everyone who joined Max (1 = first), or null before you've joined. */
  memberNumber(ownerId: string): Promise<number | null>;
  /** The account with this member number, or null. */
  memberByNumber(n: number): Promise<string | null>;
  /** How many accounts joined Max through this account's invite link. A count only: never who. */
  invitedCount(account: string): Promise<number>;
  /** Admins only (lib/domain/admin.ts): every row of a table across all accounts, newest first. */
  listAll<T extends ListAllTable>(table: T, limit: number): Promise<Tables[T][]>;
}

export type ListAllTable = "settings" | "moderation" | "sites" | "orgs" | "orgEvents" | "audit";
export type CrossTable = "shares" | "shareLinks" | "presence" | "collabRooms" | "collabUpdates" | "collabAwareness" | "sites" | "usernames" | "orgs" | "orgMembers" | "orgInvites";
export type CrossField<T extends CrossTable> = T extends "orgs"
  ? "slug"
  : T extends "orgMembers"
    ? "accountId"
    : T extends "orgInvites"
      ? "email"
      : T extends "shares"
  ? "granteeId" | "pageId"
  : T extends "shareLinks"
    ? "token" | "pageId"
    : T extends "collabUpdates"
      ? "roomId"
      : T extends "sites"
        ? "slug" | "pageId"
        : T extends "usernames"
          ? "username"
          : "pageId";

export type IndexedField<T extends TableName> = T extends "orgMembers"
  ? "accountId"
  : T extends "pages"
  ? "parentId" | "databaseId"
  : T extends "documents"
    ? "pageId"
    : T extends "assets"
      ? "pageId"
      : T extends "idempotency"
        ? "key"
        : T extends "versions"
          ? "pageId"
          : T extends "comments"
            ? "pageId"
            : T extends "shares" | "shareLinks" | "presence" | "collabRooms" | "collabAwareness" | "sites"
              ? "pageId"
              : never;

export interface Storage {
  /** URL the browser can POST a file body to. */
  createUploadUrl(): Promise<string>;
  /**
   * Optional direct upload (Cloudflare R2): a signed URL to PUT the file to, with the headers to
   * send, and the storage id it will have. When absent, uploads use createUploadUrl.
   */
  createUpload?(file: { type: string; size: number; ownerId: string }): Promise<{ url: string; method: "PUT"; headers: Record<string, string>; storageId: string } | null>;
  getUrl(storageId: string): Promise<string | null>;
  remove(storageId: string): Promise<void>;
}
