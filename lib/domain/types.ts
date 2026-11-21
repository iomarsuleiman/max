import type { ProfileCard } from "./profileCard";

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
  | "person"
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

/**
 * A database automation (lib/domain/ops/recordHooks.ts): deterministic, runs in the same
 * transaction as the change that triggers it, never triggers other rules.
 */
export interface AutomationRule {
  id: string;
  name: string;
  enabled: boolean;
  trigger:
    | { type: "created" }
    | { type: "changed"; propertyId: string; to?: string | boolean | null }
    | { type: "button"; label: string }
    | { type: "schedule"; every: "day" | "week" | "month"; title: string };
  actions: AutomationAction[];
  runs?: number;
  lastRunAt?: number | null;
  lastError?: string | null;
}
export type AutomationAction =
  | { type: "set"; propertyId: string; value: unknown }
  | { type: "set_now"; propertyId: string }
  | { type: "assign_actor"; propertyId: string }
  | { type: "notify"; to: "assignees" | "creator" | string[]; message: string };

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
  /** Who created it and who last changed it (set where an acting person is known). */
  createdBy?: string | null;
  updatedBy?: string | null;
  /** Databases only: their automations. */
  automations?: AutomationRule[];
  /** Wiki verification: who vouches for this page and until when. */
  verification?: { by: string; byName: string | null; at: number; until: number } | null;
  ownerId: string;
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
  /** A teamspace: a top-level page shared with a group, listed under Teamspaces for everyone in it. */
  teamspace?: boolean;
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
  textDirection: "auto" | "ltr" | "rtl";
  spellcheck: boolean;
  showRecents: boolean;
  reduceMotion: "system" | "on";
  sidebarWidth: number;
  sidebarSections: SidebarSectionId[];
  collapsedSections: SidebarSectionId[];
  /** Sections turned off in Settings → Sidebar. */
  hiddenSections?: SidebarSectionId[];
  expandedPageIds: string[];
  lastPageId: string | null;
  displayName: string | null;
  profileCard?: ProfileCard | null;
  profileCardOnboarded?: boolean;
  /** The account that invited this one (through a card's invite link), if any. */
  invitedBy?: string | null;
  /** The sign-in email, recorded at setup so admins can recognise accounts. */
  email?: string | null;
  /** This person's handwritten note for the people they invite. */
  inviteNote?: string | null;
  /** The color of buttons, links and highlights. */
  accent?: "blue" | "purple" | "pink" | "red" | "orange" | "green" | "teal" | "graphite";
  /** The tint of the sidebar and backdrop: your card's colors, or a card palette of your choice. */
  spaceColor?: string;
  /** A custom space theme from the Space editor: 1–3 colors, grain and tint strength (0–100). */
  space?: { colors: string[]; grain: number; intensity: number } | null;
  dateFormat?: "medium" | "us" | "eu" | "iso";
  timeFormat?: "12h" | "24h";
  weekStart?: "monday" | "sunday";
  /** Pages on a floating rounded card, or edge to edge. */
  frame?: "floating" | "full";
  /** Little sounds, like the crumple when something goes to the trash. On unless turned off. */
  sounds?: boolean;
  /** The main workspace's name and icon (extra workspaces keep theirs in `workspaces`). */
  workspaceName?: string | null;
  workspaceIcon?: string | null;
  /** Extra personal workspaces, each a private namespace of its own (see lib/domain/workspaces.ts). */
  workspaces?: import("./workspaces").WorkspaceEntry[];
  /** Inbox kinds turned off (false); everything else is on. */
  notificationPrefs?: Partial<Record<NotificationKind, boolean>>;
  /** This person's own sidebar and space settings inside each organization they belong to. */
  orgPrefs?: Record<string, Partial<SettingsRow>>;
  onboarded: boolean;
  updatedAt: number;
}

export type SidebarSectionId = "favorites" | "recents" | "teamspaces" | "shared" | "pages" | "databases";

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
  /** A copy of someone else's file record (from duplicating a shared page): deleting it never deletes the file. */
  borrowed?: boolean;
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

export type Source = "ui" | "mcp" | "app";

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
  /** Who wrote it, when someone the page is shared with comments. Absent means the page owner. */
  authorId?: string | null;
  authorName?: string | null;
  authorImage?: string | null;
  /** A reply: the comment it answers (threads are one level deep, like Notion's). */
  parentId?: string | null;
  /** Emoji reactions: emoji → the accounts who reacted. */
  reactions?: Record<string, string[]>;
  /** People @mentioned in the comment (they're notified). */
  mentions?: string[];
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

/** What someone can do on a shared page (and its sub-pages), lowest to highest. */
export type ShareLevel = "view" | "comment" | "edit" | "full_access";

/** A page shared with one person. Applies to the page and everything inside it, like Notion. */
export interface ShareRow {
  _id: string;
  ownerId: string;
  pageId: string;
  granteeId: string;
  email: string | null;
  name: string | null;
  image: string | null;
  level: ShareLevel;
  invitedBy: string;
  createdAt: number;
}

/** "Anyone with the link": signed-in people holding the token get `level`. */
export interface ShareLinkRow {
  _id: string;
  ownerId: string;
  pageId: string;
  token: string;
  level: Exclude<ShareLevel, "full_access">;
  /** Published to the web: anyone with the link can view, no Max account needed. */
  public?: boolean;
  /** The link stops working at this time (null: never). */
  expiresAt?: number | null;
  createdAt: number;
}

/** Who has a page open right now (heartbeat, expires after ~45 s). */
/** A problem someone reported: a bug, or abusive content on a published page or site. */
export interface ReportRow {
  _id: string;
  /** Reports aren't owned by a workspace; this is always "reports" (the admin's inbox). */
  ownerId: string;
  reporterId: string | null;
  reporterName: string | null;
  reporterEmail: string | null;
  kind: "bug" | "content" | "other";
  message: string;
  url: string | null;
  pageId: string | null;
  siteSlug: string | null;
  status: "open" | "resolved";
  createdAt: number;
  resolvedAt: number | null;
}

/** An admin's decision about an account: suspended (read-only) or banned (no access). */
/** A person's username: max.chaos.fail/<username> is their invite link. One per account, unique. */
export interface UsernameRow {
  _id: string;
  ownerId: string;
  username: string;
  createdAt: number;
}

export interface ModerationRow {
  _id: string;
  ownerId: string;
  status: "suspended" | "banned";
  reason: string;
  by: string;
  updatedAt: number;
}

/** A page (and everything inside it) published as a website, at /site/<slug> or <slug>.<domain>. */
export interface SiteRow {
  _id: string;
  ownerId: string;
  pageId: string;
  slug: string;
  name: string;
  icon: string | null;
  description: string;
  search: boolean;
  createdAt: number;
  updatedAt: number;
  /** Published at the top level (max.chaos.fail/<slug>): Max's platform admins only. */
  root?: boolean;
}

export interface PresenceRow {
  _id: string;
  ownerId: string;
  pageId: string;
  accountId: string;
  name: string;
  image: string | null;
  at: number;
}

/** A live co-editing session for one page: an append-only stream of Yjs updates. */
export interface CollabRoomRow {
  _id: string;
  ownerId: string;
  pageId: string;
  /** Bumped when the room is reset (the page was changed outside the room); clients reload. */
  epoch: number;
  /** The document revision the room was seeded from, or last saved to. Null: needs seeding. */
  seededRevision: number | null;
  /** The client currently seeding the room from the saved document, and when it claimed it. */
  seeding: string | null;
  seedingAt: number;
  nextSeq: number;
  createdAt: number;
}

export interface CollabUpdateRow {
  _id: string;
  ownerId: string;
  roomId: string;
  pageId: string;
  epoch: number;
  seq: number;
  /** A Yjs update (or a merged snapshot), base64. */
  data: string;
  at: number;
}

/** Cursors and selections (Yjs awareness) of one editor tab. */
export interface CollabAwarenessRow {
  _id: string;
  ownerId: string;
  pageId: string;
  roomId: string;
  clientId: string;
  accountId: string;
  data: string;
  at: number;
}

/* ── Organizations (lib/domain/organizations.ts) ─────────────────────────────
 * Every org row is owned by the organization's namespace (`org_<id>`), so the same
 * ownership-scoped reads that keep personal data apart keep organizations apart. */
export type OrgRole = "owner" | "admin" | "member" | "guest";

export interface OrgPolicies {
  /** Members (not only admins) may invite people to join as members. */
  membersCanInvite: boolean;
  /** Pages may be shared with people outside the organization (they join as page guests). */
  allowGuests: boolean;
  /** Pages may be published to the web with a public link. */
  allowPublicLinks: boolean;
  /** Pages may be published as websites (admins only). */
  allowSites: boolean;
  /** Trashed pages are deleted for good after this many days (null: kept until someone deletes them). */
  trashRetentionDays?: number | null;
  /** Page history older than this many days is removed, keeping each page's latest version (null: kept). */
  versionRetentionDays?: number | null;
  /** People with a verified email at this domain may join as members without an invitation. */
  autoJoinDomain?: string | null;
}

export interface OrgRow {
  _id: string;
  /** The organization's namespace, `org_<id>`: the ownerId of all its content. */
  ownerId: string;
  name: string;
  slug: string;
  icon: string | null;
  description: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  policies: OrgPolicies;
  /** Platform-set operational limits (null: Max's defaults). */
  maxMembers: number | null;
  /**
   * The owner's security phrase (PBKDF2 hash and salt), asked before ownership transfer and
   * deletion. Works with any sign-in method, Google included: no password or email needed.
   */
  /** The auto-join domain, mirrored from policies for an indexed lookup. */
  joinDomain?: string | null;
  phraseHash?: string | null;
  phraseSalt?: string | null;
  phraseFailures?: number;
  phraseLockedUntil?: number | null;
}

export interface OrgMemberRow {
  _id: string;
  ownerId: string;
  accountId: string;
  role: OrgRole;
  status: "active" | "suspended";
  name: string | null;
  email: string | null;
  image: string | null;
  invitedBy: string | null;
  joinedAt: number;
  updatedAt: number;
}

export interface OrgInviteRow {
  _id: string;
  ownerId: string;
  /** Normalized (lower-case) email. Accepting requires this verified email on the sign-in. */
  email: string;
  role: Exclude<OrgRole, "owner">;
  status: "pending" | "accepted" | "declined" | "revoked";
  invitedBy: string;
  invitedByName: string | null;
  createdAt: number;
  expiresAt: number;
  resolvedAt: number | null;
  resolvedBy: string | null;
}

export interface OrgTeamRow {
  _id: string;
  ownerId: string;
  name: string;
  description: string;
  memberIds: string[];
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** Append-only audit trail. ownerId is the organization's namespace, or "platform" for Max's admins. */
export interface OrgEventRow {
  _id: string;
  ownerId: string;
  actorId: string;
  actorName: string | null;
  action: string;
  targetId: string | null;
  detail: string | null;
  at: number;
}

/** A page (and everything inside it) limited to chosen members and teams of its organization. */
export interface OrgPageAccessRow {
  _id: string;
  ownerId: string;
  pageId: string;
  memberIds: string[];
  teamIds: string[];
  /** What everyone else in the organization gets: nothing (hidden), view or comment. */
  othersLevel?: "none" | "view" | "comment";
  /** Closed: hidden, but listed by name so people can ask to join. */
  listed?: boolean;
  createdBy: string;
  updatedAt: number;
}

export type NotificationKind = "mention" | "comment" | "assigned" | "approval" | "access" | "membership" | "automation" | "reminder" | "announcement";

/** One inbox item (lib/domain/notifications.ts). ownerId is the RECIPIENT account. */
export interface NotificationRow {
  _id: string;
  ownerId: string;
  kind: NotificationKind;
  /** The namespace it's about: an organization or a personal workspace. */
  scope: string | null;
  pageId: string | null;
  actorId: string | null;
  actorName: string | null;
  title: string;
  body: string | null;
  key: string | null;
  readAt: number | null;
  at: number;
}

/**
 * A review request on a page, or a suggested edit awaiting review (lib/domain/ops/approvals.ts).
 * Decisions are append-only: nothing in the history is ever rewritten.
 */
export interface ApprovalRow {
  _id: string;
  ownerId: string;
  pageId: string;
  kind: "review" | "suggestion";
  requestedBy: string;
  requestedByName: string | null;
  reviewers: string[];
  message: string;
  status: "pending" | "approved" | "changes_requested" | "cancelled";
  decisions: { by: string; byName: string | null; decision: "approved" | "changes_requested" | "cancelled"; note: string; at: number }[];
  /** Suggested edits: the proposed blocks (JSON) and the revision they were made from. */
  proposal: string | null;
  baseRevision: number | null;
  createdAt: number;
  updatedAt: number;
}

/** A connector (app) registered by a developer (lib/domain/integrations.ts). ownerId: the developer's account. */
export interface IntegrationRow {
  _id: string;
  ownerId: string;
  name: string;
  description: string;
  icon: string | null;
  website: string | null;
  scopes: string[];
  redirectUris: string[];
  webhookUrl: string | null;
  events: string[];
  clientSecretHash: string;
  signingSecret: string;
  status: "private" | "submitted" | "published" | "rejected" | "suspended";
  reviewNote: string | null;
  installs?: number;
  createdAt: number;
  updatedAt: number;
}

/** An app connected to one workspace or organization (ownerId: that namespace). */
export interface InstallationRow {
  _id: string;
  ownerId: string;
  integrationId: string;
  installedBy: string;
  scopes: string[];
  tokenHash: string | null;
  tokenPrefix: string | null;
  codeHash: string | null;
  codeExpiresAt: number | null;
  redirectUri: string | null;
  revokedAt: number | null;
  lastUsedAt: number | null;
  createdAt: number;
}

export interface WebhookDeliveryRow {
  _id: string;
  ownerId: string;
  installationId: string;
  integrationId: string;
  event: string;
  payload: string;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  nextAt: number;
  lastError: string | null;
  createdAt: number;
}

/** When a recurring automation next creates its row (one per schedule rule). ownerId: its namespace. */
export interface ScheduleRow {
  _id: string;
  ownerId: string;
  databaseId: string;
  ruleId: string;
  nextAt: number;
}

export interface Tables {
  schedules: ScheduleRow;
  integrations: IntegrationRow;
  installations: InstallationRow;
  webhookDeliveries: WebhookDeliveryRow;
  approvals: ApprovalRow;
  notifications: NotificationRow;
  orgPageAccess: OrgPageAccessRow;
  orgs: OrgRow;
  orgMembers: OrgMemberRow;
  orgInvites: OrgInviteRow;
  orgTeams: OrgTeamRow;
  orgEvents: OrgEventRow;
  pages: PageRow;
  documents: DocumentRow;
  settings: SettingsRow;
  assets: AssetRow;
  tokens: TokenRow;
  audit: AuditRow;
  idempotency: IdempotencyRow;
  versions: VersionRow;
  comments: CommentRow;
  shares: ShareRow;
  shareLinks: ShareLinkRow;
  presence: PresenceRow;
  sites: SiteRow;
  reports: ReportRow;
  moderation: ModerationRow;
  usernames: UsernameRow;
  collabRooms: CollabRoomRow;
  collabUpdates: CollabUpdateRow;
  collabAwareness: CollabAwarenessRow;
}

export type TableName = keyof Tables;
