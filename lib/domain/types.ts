import type { ProfileCard } from "./profileCard";
import type { UploadReceipt } from "./uploads";

/** Shared domain types. Every row is owned by exactly one account (`ownerId`). */

export type PageKind = "page" | "database";

export type PropertyType =
  | "title"
  | "text"
  | "number"
  | "select"
  | "multi_select"
  | "status"
  | "checkbox"
  | "date"
  | "url"
  | "email"
  | "relation"
  | "phone"
  | "formula"
  | "rollup"
  | "created_time"
  | "updated_time";

export type OptionColor =
  | "gray"
  | "brown"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "purple"
  | "pink"
  | "red";

export interface SelectOption {
  id: string;
  name: string;
  color: OptionColor;
}

export interface PropertyDef {
  id: string;
  name: string;
  type: PropertyType;
  options?: SelectOption[];
  /** For relation properties: the target database page id. */
  relationDatabaseId?: string;
  numberFormat?: "number" | "percent" | "currency";
  /** Formula properties: expression such as `prop("Price") * prop("Qty")`. */
  formula?: string;
  /** Rollup properties: which relation to follow, which target property, and how to aggregate. */
  rollup?: { relationPropertyId: string; targetPropertyId: string; fn: RollupFn };
}

export type RollupFn = "count" | "count_values" | "sum" | "average" | "min" | "max" | "percent_checked" | "show_original";

export type FilterOperator =
  | "contains"
  | "not_contains"
  | "equals"
  | "not_equals"
  | "is_empty"
  | "is_not_empty"
  | "gt"
  | "lt"
  | "is_checked"
  | "is_not_checked"
  | "before"
  | "after";

export interface ViewFilter {
  id: string;
  propertyId: string;
  operator: FilterOperator;
  value?: string | number | boolean | null;
}

export interface ViewSort {
  propertyId: string;
  direction: "asc" | "desc";
}

export type CalculationFn =
  | "count_all"
  | "count_values"
  | "count_empty"
  | "count_unique"
  | "percent_empty"
  | "percent_not_empty"
  | "sum"
  | "average"
  | "median"
  | "min"
  | "max"
  | "range"
  | "earliest"
  | "latest"
  | "checked"
  | "unchecked"
  | "percent_checked";

export type ViewType = "table" | "board" | "list" | "gallery" | "calendar";

export interface DatabaseView {
  id: string;
  name: string;
  type: ViewType;
  /** Calendar views: the date property that places rows on days. */
  datePropertyId?: string | null;
  /** Footer calculations per property (table views), e.g. { views: "sum" }. */
  calculations?: Record<string, CalculationFn>;
  /** How rows open from this view, like Notion: side peek, center peek, or full page. */
  openPagesIn?: "side" | "center" | "full";
  /** Gallery views: show the page cover/first image. */
  cardPreview?: "cover" | "none";
  filters: ViewFilter[];
  sorts: ViewSort[];
  hiddenPropertyIds: string[];
  propertyOrder: string[];
  columnWidths: Record<string, number>;
  groupByPropertyId?: string | null;
}

export type PropertyValue = string | number | boolean | string[] | null;

export interface PageRow {
  _id: string;
  ownerId: string;
  /** Additive v2 scope. Legacy unscoped rows remain personal until backfilled. */
  workspaceId?: string;
  teamspaceId?: string | null;
  kind: PageKind;
  parentId: string | null;
  /** Set when this page is a record inside a personal database. */
  databaseId: string | null;
  title: string;
  icon: string | null;
  cover: string | null;
  /** Vertical cover crop, 0–100. Older pages default to the center. */
  coverPosition?: number;
  rank: string;
  favoriteRank: string | null;
  archivedAt: number | null;
  /** The page the user actually moved to trash (subtree members point at it). */
  archivedRootId: string | null;
  lastOpenedAt: number | null;
  fullWidth: boolean;
  smallText: boolean;
  locked: boolean;
  /** Templates never appear in the tree, search or database rows; they're copied into new pages. */
  isTemplate: boolean;
  createdAt: number;
  updatedAt: number;
  /** Database pages only. */
  properties?: PropertyDef[];
  views?: DatabaseView[];
  /** Database record pages only: values keyed by property id. */
  values?: Record<string, PropertyValue>;
}

export interface DocumentRow {
  _id: string;
  ownerId: string;
  pageId: string;
  /** Canonical BlockNote JSON, serialized. */
  content: string;
  /** Plain text extract used for search and word counts. */
  text: string;
  revision: number;
  schemaVersion: number;
  wordCount: number;
  updatedAt: number;
}

export interface SettingsRow {
  /** First creation of this Max workspace, independent of card edits. */
  joinedAt?: number;
  _id: string;
  ownerId: string;
  theme: "system" | "light" | "dark";
  font: "default" | "serif" | "mono";
  defaultFullWidth: boolean;
  density: "comfortable" | "compact";
  startPage: "home" | "last";
  textDirection: "auto" | "ltr" | "rtl";
  spellcheck: boolean;
  showRecents: boolean;
  reduceMotion: "system" | "on";
  sidebarWidth: number;
  sidebarSections: SidebarSectionId[];
  collapsedSections: SidebarSectionId[];
  expandedPageIds: string[];
  lastPageId: string | null;
  displayName: string | null;
  profileCard?: ProfileCard | null;
  profileCardOnboarded?: boolean;
  onboarded: boolean;
  updatedAt: number;
}

export type SidebarSectionId = "favorites" | "recents" | "pages" | "databases";

export interface AssetRow {
  _id: string;
  ownerId: string;
  pageId: string | null;
  storageId: string;
  name: string;
  type: string;
  size: number;
  alt: string;
  createdAt: number;
}

export interface TokenRow {
  _id: string;
  ownerId: string;
  name: string;
  hash: string;
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

export interface AuditRow {
  _id: string;
  ownerId: string;
  op: string;
  source: Source;
  targetId: string | null;
  ok: boolean;
  code: string | null;
  at: number;
}

export type Source = "ui" | "mcp";

/** A personal note on a page or on one of its blocks (Max has no collaborators: comments are for you). */
export interface CommentRow {
  _id: string;
  ownerId: string;
  pageId: string;
  /** Null for a comment on the whole page. */
  blockId: string | null;
  body: string;
  resolvedAt: number | null;
  createdAt: number;
  updatedAt: number;
  source: Source;
}

/** A saved earlier state of a page's content (page history). */
export interface VersionRow {
  _id: string;
  ownerId: string;
  pageId: string;
  /** The document revision this snapshot captured. */
  revision: number;
  title: string;
  content: string;
  wordCount: number;
  /** When this state was current (its last edit). */
  at: number;
  source: Source;
  reason: "edit" | "assistant" | "before-restore" | "manual";
}

/** Remembers the result of a write sent with an idempotency key, so a retry doesn't apply it twice. */
export interface IdempotencyRow {
  _id: string;
  ownerId: string;
  key: string;
  op: string;
  result: string;
  at: number;
}

export interface Tables {
  pages: PageRow;
  documents: DocumentRow;
  settings: SettingsRow;
  assets: AssetRow;
  tokens: TokenRow;
  audit: AuditRow;
  idempotency: IdempotencyRow;
  versions: VersionRow;
  comments: CommentRow;
  uploadReceipts: UploadReceipt & { _id: string };
}

export type TableName = keyof Tables;
