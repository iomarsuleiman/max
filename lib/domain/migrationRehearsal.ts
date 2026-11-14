import type { AssetRow, CommentRow, DocumentRow, PageRow, VersionRow } from "./types";

/**
 * A read-only preflight for IN-PLACE personal -> workspace backfill.
 * No IDs, BlockNote JSON, revisions, authorship, files or original rows change.
 * The caller must gather a consistent snapshot in a trusted backend.
 */
export interface PersonalMigrationSnapshot {
  pages: readonly PageRow[];
  documents: readonly DocumentRow[];
  assets: readonly AssetRow[];
  comments: readonly CommentRow[];
  versions: readonly VersionRow[];
}

export interface PersonalWorkspaceMapping {
  ownerId: string;
  personalWorkspaceId: string;
}

export interface MigrationRehearsal {
  ownerId: string;
  workspaceId: string;
  dryRun: true;
  /** Stable, deterministic old IDs; never generated copies. */
  pageIds: string[];
  documentIds: string[];
  assetIds: string[];
  commentIds: string[];
  versionIds: string[];
  /** Mapping is reused on retry and can be reversed after cutover. */
  rollback: PersonalWorkspaceMapping;
}

export class UnsafeMigrationSnapshot extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeMigrationSnapshot";
  }
}

function indexRows<T extends { _id: string; ownerId: string }>(rows: readonly T[], table: string): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) {
    if (!row._id || !row.ownerId || map.has(row._id)) throw new UnsafeMigrationSnapshot(`${table}: duplicate or invalid ID`);
    map.set(row._id, row);
  }
  return map;
}

export function rehearsePersonalMigration(
  snapshot: PersonalMigrationSnapshot,
  ownerId: string,
  personalWorkspaceId: string,
  existingMapping?: PersonalWorkspaceMapping,
): MigrationRehearsal {
  if (!ownerId.trim() || !personalWorkspaceId.trim()) throw new UnsafeMigrationSnapshot("Missing owner/workspace identity");
  if (existingMapping && (existingMapping.ownerId !== ownerId || existingMapping.personalWorkspaceId !== personalWorkspaceId)) {
    throw new UnsafeMigrationSnapshot("Personal workspace mapping conflict: do not allocate a second workspace");
  }
  const pages = indexRows(snapshot.pages, "pages");
  const documents = indexRows(snapshot.documents, "documents");
  const assets = indexRows(snapshot.assets, "assets");
  const comments = indexRows(snapshot.comments, "comments");
  const versions = indexRows(snapshot.versions, "versions");
  const ownPages = [...pages.values()].filter((page) => page.ownerId === ownerId);
  const getOwnedPage = (id: string, context: string) => {
    const page = pages.get(id);
    if (!page || page.ownerId !== ownerId) throw new UnsafeMigrationSnapshot(`${context}: missing or cross-owner page reference`);
    return page;
  };

  for (const page of ownPages) {
    if (page.parentId) getOwnedPage(page.parentId, `page ${page._id} parent`);
    if (page.databaseId) {
      const database = getOwnedPage(page.databaseId, `page ${page._id} database`);
      if (database.kind !== "database") throw new UnsafeMigrationSnapshot("Record references a non-database page");
    }
    if (page.archivedRootId) getOwnedPage(page.archivedRootId, `page ${page._id} archived root`);
    if (page.databaseId) {
      const database = getOwnedPage(page.databaseId, "record database");
      for (const property of database.properties ?? []) {
        if (property.type !== "relation" || !property.relationDatabaseId) continue;
        const stored = page.values?.[property.id];
        const relatedIds = typeof stored === "string" ? [stored] : Array.isArray(stored) ? stored : [];
        for (const relatedId of relatedIds) {
          const target = getOwnedPage(relatedId, "record relation");
          if (target.databaseId !== property.relationDatabaseId) {
            throw new UnsafeMigrationSnapshot("Record relation crosses database scope");
          }
        }
      }
    }
    // Relation database definitions are also parent-tenant data.
    for (const prop of page.properties ?? []) {
      if (prop.relationDatabaseId && getOwnedPage(prop.relationDatabaseId, "relation").kind !== "database") {
        throw new UnsafeMigrationSnapshot("Relation target is not a database");
      }
    }
    const ancestors = new Set([page._id]);
    let next = page.parentId;
    while (next) {
      if (ancestors.has(next)) throw new UnsafeMigrationSnapshot("Page ancestry cycle");
      ancestors.add(next);
      next = getOwnedPage(next, "page ancestor").parentId;
    }
  }

  function linkedIds<T extends { _id: string; ownerId: string; pageId: string }>(table: Map<string, T>, name: string): string[] {
    return [...table.values()].filter((row) => row.ownerId === ownerId).map((row) => {
      getOwnedPage(row.pageId, `${name} ${row._id}`);
      return row._id;
    }).sort();
  }
  const ownDocuments = [...documents.values()].filter((row) => row.ownerId === ownerId);
  const seenDocuments = new Set<string>();
  for (const doc of ownDocuments) {
    getOwnedPage(doc.pageId, "document");
    if (seenDocuments.has(doc.pageId)) throw new UnsafeMigrationSnapshot("Multiple documents attached to one page");
    seenDocuments.add(doc.pageId);
  }
  const ownAssets = [...assets.values()].filter((row) => row.ownerId === ownerId);
  for (const asset of ownAssets) if (asset.pageId) getOwnedPage(asset.pageId, "asset");

  return {
    ownerId,
    workspaceId: personalWorkspaceId,
    dryRun: true,
    pageIds: ownPages.map((page) => page._id).sort(),
    documentIds: ownDocuments.map((row) => row._id).sort(),
    assetIds: ownAssets.map((row) => row._id).sort(),
    commentIds: linkedIds(comments, "comment"),
    versionIds: linkedIds(versions, "version"),
    rollback: { ownerId, personalWorkspaceId },
  };
}
