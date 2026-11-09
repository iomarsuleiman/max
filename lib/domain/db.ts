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
}

export type IndexedField<T extends TableName> = T extends "pages"
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
            : never;

export interface Storage {
  /** URL the browser can POST a file body to. */
  createUploadUrl(): Promise<string>;
  getUrl(storageId: string): Promise<string | null>;
  remove(storageId: string): Promise<void>;
}
