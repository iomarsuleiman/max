import { validPrincipalId, validScopeId } from "./workspaceManagementPolicy";

const statuses = new Set(["active", "suspended", "revoked"]);
const levels = new Set(["view", "comment", "edit_content", "edit", "full_access"]);
const roles = new Set(["owner", "admin", "member", "guest"]);

/** Validate the entire bounded affiliation set, not only the row being changed.
 * An unrelated malformed/duplicated row must not be hidden by a valid update. */
export function validAffiliationRows(
  rows: readonly unknown[], workspaceId: string, accountId: string,
  kind: "group" | "teamspace",
): boolean {
  if (rows.length > 100) return false;
  const seen = new Set<string>();
  const key = kind === "group" ? "groupId" : "teamspaceId";
  for (const value of rows) {
    if (!value || typeof value !== "object") return false;
    const row = value as Record<string, unknown>;
    const id = row[key];
    if (row.workspaceId !== workspaceId || row.accountId !== accountId ||
        typeof id !== "string" || !validScopeId(id) || seen.has(id) ||
        !statuses.has(String(row.status))) return false;
    seen.add(id);
  }
  return true;
}

/** Reject malformed and duplicate grants anywhere on the page, not just the
 * requested subject. A corrupt ACL needs explicit repair before further writes. */
export function validPageGrantRows(
  rows: readonly unknown[], workspaceId: string, pageId: string,
): boolean {
  if (rows.length > 100) return false;
  const seen = new Set<string>();
  for (const value of rows) {
    if (!value || typeof value !== "object") return false;
    const row = value as Record<string, unknown>;
    const type = row.subjectType;
    const id = row.subjectId;
    if (row.workspaceId !== workspaceId || row.pageId !== pageId ||
        typeof id !== "string" || typeof type !== "string" ||
        !["account", "group", "workspace_role"].includes(type) ||
        !(type === "account" ? validPrincipalId(id) :
          type === "group" ? validScopeId(id) : roles.has(id)) ||
        !["allow", "deny"].includes(String(row.effect)) ||
        !levels.has(String(row.level))) return false;
    const key = JSON.stringify([type, id]);
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}
