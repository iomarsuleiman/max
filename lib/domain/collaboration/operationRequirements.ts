import type { PageCapability } from "./policy";

/**
 * Design contract only. The live owner-scoped dispatcher does not consume this
 * manifest. A declaration is never an authorization decision or a rollout flag.
 */
type Field = "id" | "ids" | "pageId" | "databaseId" | "parentId" | "fromPageId" | "templateId" | "relationDatabaseId" | "inside" | "jobId";
export type PageTarget =
  | { kind: "argument"; field: Field }
  | { kind: "each_argument"; field: "ids" }
  | { kind: "entity_page"; entity: "asset" | "comment" | "version"; field: "id" }
  | { kind: "record_database"; field: "id" | "ids" }
  | { kind: "source_parent"; field: "id" }
  | { kind: "template_database"; field: "templateId" }
  | { kind: "job_destination"; field: "jobId" };

type CapabilitySet = readonly [PageCapability, ...PageCapability[]];
type Condition = { kind: "always" } | { kind: "if_present" } | { kind: "if_true"; field: "restoreTitle" };
type DestinationCondition = { kind: "always" } | { kind: "if_no_databaseId" } | { kind: "if_template_kind"; template: "page" | "row" };
export type PageSelection =
  | { kind: "workspace_pages" }
  | { kind: "argument_subtree"; field: "id" | "templateId" | "ids"; condition: "always" | "includeChildren_defaults_true" | "same_archive_root" }
  | { kind: "database_rows"; database: PageTarget }
  | { kind: "optional_database_templates"; field: "databaseId" }
  | {
      kind: "related_results";
      targets: readonly ("ancestors" | "children" | "backlinks" | "mentions" | "relations" | "rollups" | "graph_endpoints" | "assets")[];
    };

/** Non-page checks deliberately have no implied mapping to a page grant. */
export type RequirementCheck =
  | { kind: "account"; data: "preferences" | "credentials" | "audit" | "connector" | "connector_jobs" | "unbound_assets"; action: "read" | "write" }
  | { kind: "personal_only"; action: "initialize" | "delete_account_data" | "import_backup" | "purge_trash" }
  | { kind: "page"; target: PageTarget; capabilities: CapabilitySet; condition: Condition }
  | {
      kind: "destination";
      target: PageTarget | { kind: "workspace_root" };
      capabilities: CapabilitySet;
      root: "requires_separate_workspace_create_authority";
      condition: DestinationCondition;
    }
  | { kind: "filter_results"; selection: PageSelection; capability: "page.read" | "page.export"; before: "pagination_counts_aggregation_and_serialization" }
  | { kind: "every_selected_page"; selection: PageSelection; capabilities: CapabilitySet; failure: "reject_entire_operation" }
  | { kind: "catalog"; data: "built_in_templates" | "capability_metadata" }
  | {
      kind: "import_existing_map";
      field: "existing";
      read: "page.read";
      rewrite: "page.edit_content";
      destination: "page.create_child";
      provenance: "same_authorized_import_job";
    }
  | { kind: "batch_items"; each: "classify_and_authorize_in_transaction"; nestedBatch: "reject"; unknown: "deny" };

export type EnforcementGate =
  | "personal_navigation_overlay"
  | "account_deletion_boundaries"
  | "token_scope_and_revocation"
  | "settings_resource_validation"
  | "upload_session_ownership"
  | "attachment_reference_closure"
  | "revocable_asset_delivery"
  | "relation_target_and_rollup_filtering"
  | "implicit_option_schema_write"
  | "comment_author"
  | "comment_author_or_moderator"
  | "copy_ownership_and_reference_remap"
  | "restore_destination_and_inheritance"
  | "shared_purge_contract_missing"
  | "fresh_background_job_authority"
  | "external_fetch_safety"
  | "oauth_ui_only"
  | "atomic_policy_preflight";

export type OperationClassification = "account_only" | "personal_only" | "page" | "discovery" | "compound" | "recursive" | "batch" | "catalog" | "external";
export interface DeclaredOperationRequirements {
  kind: "declared_requirements";
  classification: OperationClassification;
  surface: "ui_and_mcp" | "ui_only" | "mcp_only";
  checks: readonly [RequirementCheck, ...RequirementCheck[]];
  gates: readonly EnforcementGate[];
  /** Handler-specific obligations, not a claim the current handler enforces them. */
  notes: string;
}
export type UnclassifiedOperation = { kind: "deny"; reason: "unclassified_operation" };

/** All transports, subscriptions, file routes and scheduled jobs need these. */
export const COMMON_OPERATION_OBLIGATIONS = Object.freeze([
  "derive_actor_and_workspace_server_side",
  "fresh_membership_and_resource_grants",
  "deny_revoked_membership_before_reads_writes_and_job_replay",
  "intersect_token_workspace_resource_and_action_scope",
  "reauthorize_idempotency_replay_before_returning_cached_data",
  "redact_unauthorized_ids_as_missing",
  "preserve_confirmation_validation_and_transaction_guards",
] satisfies readonly string[]);

const arg = (field: Field): PageTarget => ({ kind: "argument", field });
const eachId: PageTarget = { kind: "each_argument", field: "ids" };
const parent: PageTarget = arg("parentId");
const workspace: PageSelection = { kind: "workspace_pages" };
const related: PageSelection = { kind: "related_results", targets: ["ancestors", "children", "backlinks", "mentions", "relations", "rollups", "assets"] };
const page = (target: PageTarget, ...capabilities: [PageCapability, ...PageCapability[]]): RequirementCheck => ({
  kind: "page",
  target,
  capabilities,
  condition: { kind: "always" },
});
const optionalPage = (field: Field, capability: PageCapability): RequirementCheck => ({
  kind: "page",
  target: arg(field),
  capabilities: [capability],
  condition: { kind: "if_present" },
});
const entity = (type: "asset" | "comment" | "version", capability: PageCapability): RequirementCheck =>
  page({ kind: "entity_page", entity: type, field: "id" }, capability);
const destination = (
  target: Extract<RequirementCheck, { kind: "destination" }>["target"] = parent,
  condition: DestinationCondition = { kind: "always" },
): RequirementCheck => ({
  kind: "destination",
  target,
  capabilities: ["page.create_child"],
  root: "requires_separate_workspace_create_authority",
  condition,
});
const filter = (selection: PageSelection = workspace, capability: "page.read" | "page.export" = "page.read"): RequirementCheck => ({
  kind: "filter_results",
  selection,
  capability,
  before: "pagination_counts_aggregation_and_serialization",
});
const subtree = (
  field: "id" | "templateId" | "ids",
  capability: PageCapability,
  condition: "always" | "includeChildren_defaults_true" | "same_archive_root" = "always",
): RequirementCheck => ({
  kind: "every_selected_page",
  selection: { kind: "argument_subtree", field, condition },
  capabilities: [capability],
  failure: "reject_entire_operation",
});
const databaseRows = (field: "databaseId", capability: PageCapability): RequirementCheck => ({
  kind: "every_selected_page",
  selection: { kind: "database_rows", database: arg(field) },
  capabilities: [capability],
  failure: "reject_entire_operation",
});
const account = (
  data: "preferences" | "credentials" | "audit" | "connector" | "connector_jobs" | "unbound_assets",
  action: "read" | "write",
): RequirementCheck => ({ kind: "account", data, action });
const personal = (action: "initialize" | "delete_account_data" | "import_backup" | "purge_trash"): RequirementCheck => ({ kind: "personal_only", action });

function requirement(
  classification: OperationClassification,
  checks: [RequirementCheck, ...RequirementCheck[]],
  notes: string,
  gates: EnforcementGate[] = [],
  surface: DeclaredOperationRequirements["surface"] = "ui_and_mcp",
): DeclaredOperationRequirements {
  return { kind: "declared_requirements", classification, surface, checks, gates, notes };
}

/** Explicit entries only. Never infer access from query/mutation or a name prefix. */
export const OPERATION_REQUIREMENTS = Object.freeze({
  "settings.get": requirement(
    "account_only",
    [account("preferences", "read")],
    "Personal preferences/card only; page references must be redacted after revocation.",
    ["settings_resource_validation"],
  ),
  "settings.update": requirement(
    "account_only",
    [account("preferences", "write")],
    "Names and theme remain personal. Validate last-page/icon/cover references without granting page writes.",
    ["settings_resource_validation"],
  ),
  "settings.reset": requirement("account_only", [account("preferences", "write")], "Reset only the actor's preferences; never organization defaults."),
  "account.init": requirement(
    "personal_only",
    [personal("initialize"), account("preferences", "write")],
    "Create the actor's personal workspace/welcome page idempotently, never seed an organization by changing ownerId.",
  ),
  "account.deleteAllData": requirement(
    "personal_only",
    [personal("delete_account_data"), account("credentials", "write")],
    "Never delete shared workspace content on account deletion. Revoke credentials, preserve other members, protect/transfer the last owner and preserve shared attachment references.",
    ["account_deletion_boundaries", "attachment_reference_closure"],
    "ui_only",
  ),
  "tokens.list": requirement(
    "account_only",
    [account("credentials", "read")],
    "List only actor-owned safe token metadata; no hashes or secret values.",
    ["token_scope_and_revocation"],
    "ui_only",
  ),
  "tokens.create": requirement(
    "account_only",
    [account("credentials", "write")],
    "Future tokens need explicit workspace/resource/action scopes; minting cannot expand the actor's grants.",
    ["token_scope_and_revocation"],
    "ui_only",
  ),
  "tokens.revoke": requirement(
    "account_only",
    [account("credentials", "write")],
    "Resolve token ownership server-side; revoke active subscriptions and cached access as well as future calls.",
    ["token_scope_and_revocation"],
    "ui_only",
  ),
  "audit.list": requirement(
    "account_only",
    [account("audit", "read")],
    "Personal assistant audit only. Shared audit administration needs a separate authority; redact targets after loss of access.",
    [],
    "ui_only",
  ),
  "profileCard.get": requirement("account_only", [account("preferences", "read")], "The saved card remains private account data, not an organization profile."),
  "profileCard.update": requirement(
    "account_only",
    [account("preferences", "write")],
    "Keep workspace-display-name synchronization personal; a card change cannot rename an organization.",
  ),
  "profileCard.export": requirement(
    "account_only",
    [account("preferences", "read")],
    "Render only the actor's saved private card; export does not publish it.",
  ),

  "workspace.overview": requirement(
    "discovery",
    [filter()],
    "Filter all pages/documents before word counts, trash/template counts, activity and recent/favorite summaries.",
    ["personal_navigation_overlay"],
  ),
  "pages.tree": requirement("discovery", [filter()], "Filter page metadata and parent links; do not disclose inaccessible ancestor names or IDs."),
  "pages.children": requirement(
    "discovery",
    [optionalPage("parentId", "page.read"), filter()],
    "Null parent lists only authorized workspace roots; a readable parent does not imply all children are readable.",
  ),
  "pages.get": requirement(
    "page",
    [page(arg("id"), "page.read"), filter(related)],
    "Filter breadcrumbs, children, backlinks, database metadata and archived-root references independently.",
  ),
  "pages.backlinks": requirement(
    "discovery",
    [page(arg("id"), "page.read"), filter(related)],
    "Require both backlink endpoints; titles/snippets cannot reveal unreadable source documents.",
  ),
  "pages.recents": requirement(
    "discovery",
    [account("preferences", "read"), filter()],
    "Use actor-specific recent state and remove revoked pages before ordering/limiting.",
    ["personal_navigation_overlay"],
  ),
  "pages.favorites": requirement("discovery", [account("preferences", "read"), filter()], "Favorite ranks are per actor, with inaccessible pages omitted.", [
    "personal_navigation_overlay",
  ]),
  "pages.create": requirement(
    "compound",
    [destination()],
    "Non-null parent requires create-child; null parent requires separate workspace-root create authority. New pages inherit server-selected workspace/teamspace.",
  ),
  "pages.update": requirement(
    "page",
    [page(arg("id"), "page.edit_metadata")],
    "Title, icon, cover and lock are metadata writes; validate referenced assets and do not mistake unlock for sharing authority.",
    ["attachment_reference_closure"],
  ),
  "pages.move": requirement(
    "recursive",
    [subtree("id", "page.move"), destination()],
    "Check source subtree and destination in one transaction; prevent cycles, cross-tenant/teamspace transfer, permission escalation and loss of restricted descendants.",
    ["atomic_policy_preflight", "restore_destination_and_inheritance"],
  ),
  "pages.duplicate": requirement(
    "recursive",
    [page(arg("id"), "page.export"), subtree("id", "page.export", "includeChildren_defaults_true"), destination({ kind: "source_parent", field: "id" })],
    "Destination is the resolved source parent or database, not a client claim. Reject unauthorized selected descendants; copy owners, references, assets and relations deliberately.",
    ["copy_ownership_and_reference_remap", "attachment_reference_closure", "atomic_policy_preflight"],
  ),
  "pages.touch": requirement(
    "page",
    [page(arg("id"), "page.read"), account("preferences", "write")],
    "A read-capable viewer may update only their own recent state, never shared page state.",
    ["personal_navigation_overlay"],
  ),
  "pages.forgetRecent": requirement(
    "page",
    [page(arg("id"), "page.read"), account("preferences", "write")],
    "Remove only actor-specific recent state, including a safe local revoked-reference cleanup path.",
    ["personal_navigation_overlay"],
  ),
  "pages.setFavorite": requirement(
    "page",
    [page(arg("id"), "page.read"), account("preferences", "write")],
    "Favorite is a personal preference, not page metadata permission.",
    ["personal_navigation_overlay"],
  ),
  "pages.moveFavorite": requirement(
    "page",
    [page(arg("id"), "page.read"), account("preferences", "write")],
    "Reorder only actor-specific favorites; do not patch a shared page favoriteRank.",
    ["personal_navigation_overlay"],
  ),
  "pages.archive": requirement(
    "recursive",
    [subtree("id", "page.archive")],
    "Check every affected descendant, including database rows, before writing archive state.",
    ["atomic_policy_preflight"],
  ),
  "pages.restore": requirement(
    "recursive",
    [subtree("id", "page.restore", "same_archive_root"), destination({ kind: "source_parent", field: "id" })],
    "Check the actual restored branch and destination. A missing/archived parent cannot silently broaden access by restoring to an organization root.",
    ["restore_destination_and_inheritance", "atomic_policy_preflight"],
  ),
  "trash.list": requirement("discovery", [filter()], "Filter archived roots, descendant counts and parent titles; trash status never bypasses policy."),
  "pages.deletePermanently": requirement(
    "recursive",
    [subtree("id", "page.archive")],
    "Archive permission is not purge permission. Shared purge remains denied until a dedicated purge authority, retention rules and shared-file reference checks exist.",
    ["shared_purge_contract_missing", "attachment_reference_closure", "atomic_policy_preflight"],
  ),
  "trash.empty": requirement(
    "personal_only",
    [personal("purge_trash")],
    "Keep legacy bulk trash purge personal-only. Shared trash needs explicit per-page purge/retention authorization, not ownership of the requesting account.",
    ["shared_purge_contract_missing", "attachment_reference_closure"],
  ),

  "documents.get": requirement(
    "page",
    [page(arg("pageId"), "page.read"), filter(related)],
    "Read current page content; redact resolved mention titles and embedded database/asset previews independently.",
  ),
  "documents.save": requirement(
    "page",
    [page(arg("pageId"), "page.edit_content")],
    "Preserve revision/lock/draft safeguards. Validate embedded page/database/asset references without broadening grants.",
    ["attachment_reference_closure"],
  ),
  "documents.writeMarkdown": requirement(
    "page",
    [page(arg("pageId"), "page.edit_content")],
    "Replace and append both require content authority and fresh revision checks.",
  ),
  "blocks.get": requirement(
    "page",
    [page(arg("pageId"), "page.read")],
    "Resolve block only inside the authorized document; a stable block ID grants no access.",
  ),
  "blocks.insert": requirement(
    "page",
    [page(arg("pageId"), "page.edit_content")],
    "Validate placement and referenced resources inside the authorized document.",
    ["attachment_reference_closure"],
  ),
  "blocks.update": requirement(
    "page",
    [page(arg("pageId"), "page.edit_content")],
    "Custom block props may reference assets/databases/pages; content authority is not access to those resources.",
    ["attachment_reference_closure"],
  ),
  "blocks.delete": requirement(
    "page",
    [page(arg("pageId"), "page.edit_content")],
    "Deleting blocks is a content edit; it cannot implicitly purge shared attachment bytes.",
  ),
  "blocks.move": requirement(
    "page",
    [page(arg("pageId"), "page.edit_content")],
    "This operation moves blocks within one document. Cross-document moves need a separate source/destination contract.",
  ),
  "blocks.duplicate": requirement("page", [page(arg("pageId"), "page.edit_content")], "Duplicate inside one authorized document and retain reference checks.", [
    "attachment_reference_closure",
  ]),
  "blocks.formatText": requirement(
    "page",
    [page(arg("pageId"), "page.edit_content")],
    "Inline styles are content changes with optimistic revision protection.",
  ),
  "tables.edit": requirement(
    "page",
    [page(arg("pageId"), "page.edit_content")],
    "Block table cells/rows/columns are document content, distinct from database schema.",
  ),
  "search.query": requirement(
    "discovery",
    [optionalPage("inside", "page.read"), filter()],
    "Filter readable documents before matching snippets, rank, ancestor breadcrumbs, result limits and totals.",
  ),
  "graph.get": requirement(
    "discovery",
    [optionalPage("pageId", "page.read"), filter({ kind: "related_results", targets: ["graph_endpoints"] })],
    "Filter both endpoints before adjacency, degree, local traversal, truncation and counts; never traverse hidden nodes.",
  ),

  "databases.create": requirement("compound", [destination()], "Create database under an authorized parent or separately authorized workspace root."),
  "databases.get": requirement(
    "page",
    [page(arg("databaseId"), "page.read"), filter(related)],
    "Schema can reveal relation targets; redact inaccessible database references and computed metadata.",
    ["relation_target_and_rollup_filtering"],
  ),
  "databases.list": requirement("discovery", [filter()], "Filter database and row access before recordCount; do not disclose schema of unreadable databases."),
  "databases.query": requirement(
    "discovery",
    [page(arg("databaseId"), "page.read"), filter({ kind: "database_rows", database: arg("databaseId") }), filter(related)],
    "Filter rows and relation/rollup inputs before formulas, aggregates, group totals, unfilteredTotal and pagination.",
    ["relation_target_and_rollup_filtering"],
  ),
  "properties.add": requirement(
    "compound",
    [page(arg("databaseId"), "database.edit_schema"), optionalPage("relationDatabaseId", "page.read")],
    "Schema write includes view property ordering. Validate relation target and rollup schema without cross-workspace leaks.",
    ["relation_target_and_rollup_filtering"],
  ),
  "properties.update": requirement(
    "recursive",
    [page(arg("databaseId"), "database.edit_schema"), databaseRows("databaseId", "database.edit_values")],
    "Changing property types/options can rewrite every row; authorize all affected rows and computed target reads atomically.",
    ["relation_target_and_rollup_filtering", "atomic_policy_preflight"],
  ),
  "properties.delete": requirement(
    "recursive",
    [page(arg("databaseId"), "database.edit_schema"), databaseRows("databaseId", "database.edit_values")],
    "Deletes values from every row and changes views, filters, sorts and grouping. Preflight all affected rows.",
    ["atomic_policy_preflight"],
  ),
  "records.create": requirement(
    "compound",
    [page(arg("databaseId"), "page.create_child", "database.edit_values")],
    "Validate relation target rows; creating select/multi-select options also requires database schema authority.",
    ["implicit_option_schema_write", "relation_target_and_rollup_filtering"],
  ),
  "records.createMany": requirement(
    "compound",
    [page(arg("databaseId"), "page.create_child", "database.edit_values")],
    "Preflight each input row and all option/schema side effects; any failure rejects the entire batch.",
    ["implicit_option_schema_write", "relation_target_and_rollup_filtering", "atomic_policy_preflight"],
  ),
  "records.update": requirement(
    "compound",
    [page(arg("id"), "database.edit_values"), page({ kind: "record_database", field: "id" }, "page.read")],
    "Check the resolved parent database and referenced rows. Option-name coercion must not let content editors create schema.",
    ["implicit_option_schema_write", "relation_target_and_rollup_filtering"],
  ),
  "records.updateMany": requirement(
    "compound",
    [page(eachId, "database.edit_values"), page({ kind: "record_database", field: "ids" }, "page.read")],
    "Authorize every row and its resolved database, including mixed-database inputs, before any writes.",
    ["implicit_option_schema_write", "relation_target_and_rollup_filtering", "atomic_policy_preflight"],
  ),
  "records.move": requirement(
    "compound",
    [page(arg("id"), "page.move"), page({ kind: "record_database", field: "id" }, "database.edit_values")],
    "Reordering is structural; validate readable siblings without leaking hidden rank/row metadata.",
  ),
  "records.delete": requirement(
    "recursive",
    [subtree("ids", "page.archive")],
    "Each row may have descendants. Authorize every affected page before reversible archive.",
    ["atomic_policy_preflight"],
  ),
  "views.create": requirement(
    "page",
    [page(arg("databaseId"), "database.edit_schema")],
    "Saved shared view creation is schema configuration; future personal views need a separate per-user store.",
  ),
  "views.update": requirement(
    "page",
    [page(arg("databaseId"), "database.edit_schema")],
    "Filters, calculations, column order and grouping change the shared view, not merely one viewer's preference.",
    ["relation_target_and_rollup_filtering"],
  ),
  "views.delete": requirement(
    "page",
    [page(arg("databaseId"), "database.edit_schema")],
    "Check view ownership by authorized database and preserve the last-view invariant.",
  ),
  "views.move": requirement("page", [page(arg("databaseId"), "database.edit_schema")], "Saved view tab order is shared database schema configuration."),

  "templates.list": requirement(
    "discovery",
    [optionalPage("databaseId", "page.read"), filter({ kind: "optional_database_templates", field: "databaseId" })],
    "Template values can reveal relation targets; filter each template and inherited database access.",
    ["relation_target_and_rollup_filtering"],
  ),
  "templates.create": requirement(
    "compound",
    [
      optionalPage("fromPageId", "page.export"),
      optionalPage("databaseId", "database.edit_schema"),
      destination({ kind: "workspace_root" }, { kind: "if_no_databaseId" }),
    ],
    "For a row template the database is the destination; for a page template use explicit workspace template-create authority. Copying source metadata/content requires export authority; values may change select options.",
    ["copy_ownership_and_reference_remap", "implicit_option_schema_write", "attachment_reference_closure"],
  ),
  "templates.apply": requirement(
    "recursive",
    [
      page(arg("templateId"), "page.export"),
      subtree("templateId", "page.export"),
      destination(parent, { kind: "if_template_kind", template: "page" }),
      destination({ kind: "template_database", field: "templateId" }, { kind: "if_template_kind", template: "row" }),
    ],
    "Resolve the actual branch: a row template writes to its own database and ignores parentId; a page template uses parentId/root. Authorize only that branch's destination; reject unauthorized copied descendants and validate copied option/relationship values.",
    [
      "copy_ownership_and_reference_remap",
      "attachment_reference_closure",
      "implicit_option_schema_write",
      "relation_target_and_rollup_filtering",
      "atomic_policy_preflight",
    ],
  ),
  "gallery.list": requirement(
    "catalog",
    [{ kind: "catalog", data: "built_in_templates" }],
    "Built-in template metadata contains no workspace/private page data.",
  ),
  "gallery.install": requirement(
    "compound",
    [destination()],
    "The built-in tree can include databases and rows; enforce destination inheritance, limits and transaction boundaries for the whole new tree.",
  ),
  "versions.list": requirement(
    "page",
    [page(arg("pageId"), "page.read")],
    "History metadata is page-scoped and must disappear on revocation, including cached previews.",
  ),
  "versions.get": requirement(
    "page",
    [entity("version", "page.read"), filter(related)],
    "Resolve version ownership and its live policy page before returning historical content, deleted references or titles.",
  ),
  "versions.create": requirement(
    "page",
    [page(arg("pageId"), "page.edit_content")],
    "Snapshot creation is a write to the authorized page history; stable content/actor IDs remain required.",
  ),
  "versions.restore": requirement(
    "compound",
    [
      entity("version", "history.restore"),
      {
        kind: "page",
        target: { kind: "entity_page", entity: "version", field: "id" },
        capabilities: ["page.edit_metadata"],
        condition: { kind: "if_true", field: "restoreTitle" },
      },
    ],
    "Authorize the version's current page, snapshot outgoing content and preserve revision/lock checks. Restoring content cannot restore expired grants.",
    ["attachment_reference_closure"],
  ),
  "comments.list": requirement("page", [page(arg("pageId"), "page.read")], "Comment text, block excerpts, missing-anchor flags and counts are page-protected."),
  "comments.add": requirement(
    "page",
    [page(arg("pageId"), "page.comment")],
    "Validate block anchor within the authorized page; actor identity comes from the server.",
  ),
  "comments.update": requirement("page", [entity("comment", "page.comment")], "Page comment permission does not permit rewriting another author's text.", [
    "comment_author",
  ]),
  "comments.resolve": requirement(
    "page",
    [entity("comment", "page.comment")],
    "Resolve/reopen requires author authority or a separately defined moderator capability.",
    ["comment_author_or_moderator"],
  ),
  "comments.delete": requirement(
    "page",
    [entity("comment", "page.comment")],
    "Permanent comment deletion preserves confirmation and requires author/moderator authority in addition to page access.",
    ["comment_author_or_moderator"],
  ),

  "assets.createUploadUrl": requirement(
    "account_only",
    [account("unbound_assets", "write")],
    "An upload URL has no page argument. Bind pending storage to actor/workspace/quota before issue; upload possession cannot authorize later registration.",
    ["upload_session_ownership"],
  ),
  "assets.register": requirement(
    "compound",
    [account("unbound_assets", "write"), optionalPage("pageId", "page.edit_content")],
    "Prove the storage ID belongs to this actor's pending upload and selected workspace. Null pageId remains a private personal asset; no shared orphan ownership.",
    ["upload_session_ownership", "attachment_reference_closure"],
  ),
  "assets.getUrl": requirement(
    "page",
    [entity("asset", "page.read")],
    "Resolve asset-to-page server-side; a null-page asset uses actor ownership instead. Gate URL and bytes, use bounded validity and revoke caches/delivery.",
    ["revocable_asset_delivery"],
  ),
  "assets.list": requirement(
    "discovery",
    [optionalPage("pageId", "page.read"), account("unbound_assets", "read"), filter({ kind: "related_results", targets: ["assets"] })],
    "Filter each asset by its page or private unbound owner before totalBytes and ordering.",
  ),
  "assets.remove": requirement(
    "page",
    [entity("asset", "page.edit_content")],
    "Require private ownership for null-page assets. Detaching a page reference must not delete bytes used by another authorized page/workspace.",
    ["attachment_reference_closure"],
  ),
  "export.page": requirement(
    "compound",
    [page(arg("id"), "page.export"), filter(related, "page.export")],
    "Database Markdown includes rows; require export for every included row and prevent relation names, mention titles, database schema and attachment URLs leaking.",
  ),
  "export.all": requirement(
    "discovery",
    [account("preferences", "read"), filter(workspace, "page.export"), filter(related, "page.export")],
    "Legacy export includes personal settings. Shared export must separate settings and filter every document/row/path/relationship, including trash and templates.",
  ),
  "import.markdown": requirement(
    "compound",
    [destination()],
    "Create copies in the authorized destination; imported page/database/asset IDs confer no authority.",
  ),
  "import.bundle": requirement(
    "compound",
    [
      destination(),
      {
        kind: "import_existing_map",
        field: "existing",
        read: "page.read",
        rewrite: "page.edit_content",
        destination: "page.create_child",
        provenance: "same_authorized_import_job",
      },
    ],
    "Existing aliases can become parents and their stored documents are rewritten during link repair. Validate import provenance, read each existing page, require create-child for parent use and content authority plus revision checks for every repaired document.",
    ["copy_ownership_and_reference_remap", "atomic_policy_preflight"],
  ),
  "import.maxExport": requirement(
    "personal_only",
    [personal("import_backup")],
    "Legacy backup import has no workspace/destination selector. Keep it personal-only until a reviewed shared-copy contract exists.",
    ["copy_ownership_and_reference_remap", "attachment_reference_closure"],
  ),
  batch: requirement(
    "batch",
    [{ kind: "batch_items", each: "classify_and_authorize_in_transaction", nestedBatch: "reject", unknown: "deny" }],
    "No blanket batch edit grant. Resolve dependencies from earlier items but authorize each item with current policy inside the same atomic transaction.",
    ["atomic_policy_preflight"],
  ),
});

/** Server-composed tools and connector operations outside the domain registry. */
export const EXTERNAL_OPERATION_REQUIREMENTS = Object.freeze({
  assets_upload: requirement(
    "external",
    [account("unbound_assets", "write"), optionalPage("pageId", "page.edit_content")],
    "Authorize before fetch/upload and recheck before register; carry upload ownership across the composed operations.",
    ["external_fetch_safety", "upload_session_ownership", "attachment_reference_closure"],
    "mcp_only",
  ),
  import_html: requirement(
    "external",
    [destination()],
    "Apply import.markdown destination policy, SSRF/redirect/body limits and sanitization; check access before network effects.",
    ["external_fetch_safety"],
    "mcp_only",
  ),
  max_capabilities: requirement(
    "catalog",
    [{ kind: "catalog", data: "capability_metadata" }],
    "A capability inventory advertises tools, not access to any workspace or resource.",
    [],
    "mcp_only",
  ),
  profileCard_exportPng: requirement(
    "account_only",
    [account("preferences", "read")],
    "Composes private profileCard.export; PNG rendering cannot select another account.",
    [],
    "mcp_only",
  ),
  notion_status: requirement("external", [account("connector", "read")], "Safe metadata for actor's own provider connection; never credentials."),
  notion_sources: requirement(
    "external",
    [account("connector", "read")],
    "Provider integration access is separate from Max workspace membership; no automatic sharing of private sources.",
  ),
  notion_preview: requirement(
    "external",
    [account("connector", "read"), destination()],
    "Review selected authorized sources and exact Max destination; a preview is not a durable authorization token.",
    ["fresh_background_job_authority"],
  ),
  notion_start: requirement(
    "external",
    [account("connector", "read"), account("connector_jobs", "write"), destination()],
    "Bind job to actor, provider sources, destination workspace and token scope. Reauthorize worker checkpoints and attachment ingestion after revocation.",
    ["fresh_background_job_authority", "copy_ownership_and_reference_remap", "upload_session_ownership"],
  ),
  notion_job: requirement(
    "external",
    [account("connector_jobs", "read"), filter(related)],
    "Resolve job owner; progress/root IDs/titles and warnings can leak revoked destination content. Filter or redact it before returning.",
  ),
  notion_report: requirement(
    "external",
    [account("connector_jobs", "read"), filter(related)],
    "Owner-scoped report still needs current destination/source redaction after membership loss.",
  ),
  notion_history: requirement(
    "external",
    [account("connector_jobs", "read"), filter(related)],
    "Filter/redact every job's destination and imported content metadata; never return encrypted or plain provider tokens.",
  ),
  notion_cancel: requirement(
    "external",
    [account("connector_jobs", "write")],
    "The owner may stop their own job after destination revocation; cancellation must not expose content or delete imported copies.",
  ),
  notion_retry: requirement(
    "external",
    [account("connector_jobs", "write"), account("connector", "read"), destination({ kind: "job_destination", field: "jobId" })],
    "Load persisted job ownership and actual destination, then recheck source, page/schema, upload and token authority at each resumed checkpoint.",
    ["fresh_background_job_authority", "upload_session_ownership"],
  ),
  "notion.oauth.begin": requirement(
    "account_only",
    [account("connector", "write")],
    "UI-owned consent; bind expiring state to actor and prevent MCP from invoking it.",
    ["oauth_ui_only"],
    "ui_only",
  ),
  "notion.oauth.complete": requirement(
    "account_only",
    [account("connector", "write")],
    "UI-owned one-use state and actor verification before credential storage.",
    ["oauth_ui_only"],
    "ui_only",
  ),
  "notion.disconnect": requirement(
    "account_only",
    [account("connector", "write")],
    "Revoke only the actor's provider connection and stop its workers; existing Max copies remain.",
    ["oauth_ui_only", "fresh_background_job_authority"],
    "ui_only",
  ),
});

const operations = new Map<string, DeclaredOperationRequirements>(Object.entries(OPERATION_REQUIREMENTS));
const extras = new Map<string, DeclaredOperationRequirements>(Object.entries(EXTERNAL_OPERATION_REQUIREMENTS));
const unclassified: UnclassifiedOperation = Object.freeze({ kind: "deny", reason: "unclassified_operation" });

export function getOperationRequirements(name: string): DeclaredOperationRequirements | UnclassifiedOperation {
  return operations.get(name) ?? unclassified;
}

/** Domain tools use dot-to-underscore aliases; only explicit extra names bypass it. */
export function getMcpToolRequirements(name: string): DeclaredOperationRequirements | UnclassifiedOperation {
  const extra = extras.get(name);
  if (extra) return extra.surface === "ui_only" ? unclassified : extra;
  for (const [operationName, entry] of operations) {
    if (operationName.replaceAll(".", "_") === name) return entry.surface === "ui_only" ? unclassified : entry;
  }
  return unclassified;
}

export function getExternalOperationRequirements(name: string): DeclaredOperationRequirements | UnclassifiedOperation {
  return extras.get(name) ?? unclassified;
}
