import { describe, expect, it } from "vitest";
import { listOps } from "@/lib/domain/ops";
import { EXTRA_TOOLS, toolName } from "@/lib/server/mcp";
import { NOTION_MCP_TOOLS } from "@/lib/notion/tools";
import {
  COMMON_OPERATION_OBLIGATIONS,
  EXTERNAL_OPERATION_REQUIREMENTS,
  OPERATION_REQUIREMENTS,
  getExternalOperationRequirements,
  getMcpToolRequirements,
  getOperationRequirements,
  type DeclaredOperationRequirements,
  type EnforcementGate,
} from "@/lib/domain/collaboration/operationRequirements";

function declared(name: string): DeclaredOperationRequirements {
  const entry = getOperationRequirements(name);
  if (entry.kind !== "declared_requirements") throw new Error(`Unclassified operation: ${name}`);
  return entry;
}

describe("collaboration operation requirements contract", () => {
  it("requires an explicit classification for every real domain operation and no stale entries", () => {
    expect(Object.keys(OPERATION_REQUIREMENTS).sort()).toEqual(
      listOps()
        .map((op) => op.name)
        .sort(),
    );
    for (const op of listOps()) {
      const entry = declared(op.name);
      expect(entry.checks.length).toBeGreaterThan(0);
      expect(entry.notes.length).toBeGreaterThan(30);
      expect(entry.surface).toBe(op.uiOnly ? "ui_only" : "ui_and_mcp");
      expect(entry).not.toHaveProperty("allowed");
    }
  });

  it("covers every advertised MCP tool including composed tools and Notion operations", () => {
    const domainTools = listOps()
      .filter((op) => !op.uiOnly)
      .map((op) => toolName(op.name));
    for (const name of [...domainTools, ...EXTRA_TOOLS]) expect(getMcpToolRequirements(name).kind, name).toBe("declared_requirements");
    const extraNames = Object.entries(EXTERNAL_OPERATION_REQUIREMENTS)
      .filter(([, entry]) => entry.surface !== "ui_only")
      .map(([name]) => name);
    expect(extraNames.sort()).toEqual([...EXTRA_TOOLS].sort());
    for (const tool of NOTION_MCP_TOOLS) expect(getMcpToolRequirements(tool.name)).toEqual(getExternalOperationRequirements(tool.name));
  });

  it("denies unknown, inherited-looking, future and incorrectly aliased names", () => {
    const denied = { kind: "deny", reason: "unclassified_operation" };
    for (const name of ["", "missing", "__proto__", "constructor", "toString", "pages.share", "workspaces.invite", "documents.saveAll", "pages_create"]) {
      expect(getOperationRequirements(name)).toEqual(denied);
    }
    for (const name of [
      "__proto__",
      "pages.create",
      "pages_share",
      "tokens_create",
      "tokens_revoke",
      "audit_list",
      "account_deleteAllData",
      "notion_disconnect",
      "notion_oauth_begin",
    ]) {
      expect(getMcpToolRequirements(name), name).toEqual(denied);
    }
    expect(getExternalOperationRequirements("notion_unknown")).toEqual(denied);
    // Adding a mutation to the live registry cannot produce a default edit grant.
    expect(getOperationRequirements("future.mutation").kind).toBe("deny");
  });

  it("keeps current page-only content edits distinct from schema, personal state and credentials", () => {
    expect(declared("blocks.move").checks).toContainEqual({
      kind: "page",
      target: { kind: "argument", field: "pageId" },
      capabilities: ["page.edit_content"],
      condition: { kind: "always" },
    });
    expect(declared("tables.edit").checks).toEqual(declared("blocks.move").checks);
    expect(declared("views.update").checks).toContainEqual(expect.objectContaining({ capabilities: ["database.edit_schema"] }));
    expect(declared("pages.setFavorite").checks).toContainEqual(expect.objectContaining({ capabilities: ["page.read"] }));
    expect(declared("pages.setFavorite").gates).toContain("personal_navigation_overlay");
    expect(declared("tokens.create").classification).toBe("account_only");
    expect(declared("tokens.create").gates).toContain("token_scope_and_revocation");
  });

  it("declares per-descendant, per-row and resolved destination checks before structural writes", () => {
    for (const name of ["pages.move", "pages.archive", "pages.restore", "pages.deletePermanently", "records.delete"]) {
      expect(declared(name).classification, name).toBe("recursive");
      expect(declared(name).checks).toContainEqual(expect.objectContaining({ kind: "every_selected_page", failure: "reject_entire_operation" }));
      expect(declared(name).gates).toContain("atomic_policy_preflight");
    }
    expect(declared("pages.move").checks).toContainEqual(
      expect.objectContaining({ kind: "destination", root: "requires_separate_workspace_create_authority" }),
    );
    expect(declared("properties.update").checks).toContainEqual(
      expect.objectContaining({
        selection: { kind: "database_rows", database: { kind: "argument", field: "databaseId" } },
        capabilities: ["database.edit_values"],
      }),
    );
    expect(declared("records.updateMany").checks).toContainEqual(expect.objectContaining({ target: { kind: "each_argument", field: "ids" } }));
  });

  it("marks destructive legacy account/trash and purge semantics as unresolved for shared adapters", () => {
    expect(declared("account.deleteAllData").classification).toBe("personal_only");
    expect(declared("account.deleteAllData").gates).toContain("account_deletion_boundaries");
    expect(declared("trash.empty").classification).toBe("personal_only");
    expect(declared("import.maxExport").classification).toBe("personal_only");
    for (const name of ["pages.deletePermanently", "trash.empty"]) expect(declared(name).gates).toContain("shared_purge_contract_missing");
  });

  it("filters discovery before aggregates and resolves indirect IDs through their policy page", () => {
    for (const name of ["search.query", "graph.get", "workspace.overview", "databases.query", "databases.list", "trash.list", "export.all", "assets.list"]) {
      const filters = declared(name).checks.filter((check) => check.kind === "filter_results");
      expect(filters.length, name).toBeGreaterThan(0);
      expect(filters.every((check) => check.before === "pagination_counts_aggregation_and_serialization")).toBe(true);
    }
    for (const [name, entity] of [
      ["assets.getUrl", "asset"],
      ["versions.get", "version"],
      ["comments.update", "comment"],
    ]) {
      expect(declared(name).checks).toContainEqual(expect.objectContaining({ target: { kind: "entity_page", entity, field: "id" } }));
    }
    expect(declared("assets.getUrl").gates).toContain("revocable_asset_delivery");
    expect(declared("assets.remove").gates).toContain("attachment_reference_closure");
  });

  it("accounts for implicit schema writes and import link repairs that affect existing documents", () => {
    for (const name of ["records.create", "records.createMany", "records.update", "records.updateMany", "templates.create", "templates.apply"]) {
      expect(declared(name).gates, name).toContain("implicit_option_schema_write");
    }
    expect(declared("import.bundle").checks).toContainEqual({
      kind: "import_existing_map",
      field: "existing",
      read: "page.read",
      rewrite: "page.edit_content",
      destination: "page.create_child",
      provenance: "same_authorized_import_job",
    });
    expect(
      declared("templates.apply")
        .checks.filter((check) => check.kind === "destination")
        .map((check) => check.condition),
    ).toEqual([
      { kind: "if_template_kind", template: "page" },
      { kind: "if_template_kind", template: "row" },
    ]);
  });

  it("preserves comment authorship and title-restore metadata authority separately from page read", () => {
    expect(declared("comments.update").gates).toContain("comment_author");
    expect(declared("comments.resolve").gates).toContain("comment_author_or_moderator");
    expect(declared("versions.restore").checks).toContainEqual(expect.objectContaining({ capabilities: ["history.restore"] }));
    expect(declared("versions.restore").checks).toContainEqual(
      expect.objectContaining({ capabilities: ["page.edit_metadata"], condition: { kind: "if_true", field: "restoreTitle" } }),
    );
  });

  it("declares batch item authorization and freshness obligations before cached or background work", () => {
    expect(declared("batch").checks).toEqual([{ kind: "batch_items", each: "classify_and_authorize_in_transaction", nestedBatch: "reject", unknown: "deny" }]);
    expect(COMMON_OPERATION_OBLIGATIONS).toContain("reauthorize_idempotency_replay_before_returning_cached_data");
    expect(COMMON_OPERATION_OBLIGATIONS).toContain("intersect_token_workspace_resource_and_action_scope");
    for (const name of ["notion_start", "notion_retry"]) {
      const entry = getExternalOperationRequirements(name);
      expect(entry.kind).toBe("declared_requirements");
      if (entry.kind === "declared_requirements") expect(entry.gates).toContain("fresh_background_job_authority" satisfies EnforcementGate);
    }
    const cancellation = getExternalOperationRequirements("notion_cancel");
    if (cancellation.kind !== "declared_requirements") throw new Error("Missing cancellation requirements");
    expect(cancellation.checks.every((check) => check.kind === "account")).toBe(true);
    for (const name of ["notion.oauth.begin", "notion.oauth.complete", "notion.disconnect"]) {
      const entry = getExternalOperationRequirements(name);
      expect(entry).toMatchObject({ kind: "declared_requirements", surface: "ui_only" });
    }
  });
});
