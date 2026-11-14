import { validPrincipalId, validWorkspaceId } from "./workspaceManagementPolicy";
import { workspacePreviewHref, type WorkspaceNavigationSummary } from "./workspaceNavigation";

/** Preview navigation metadata only. No page IDs, content, search or ACLs. */
export interface ScopedPreviewNavigationState {
  collapsed: boolean;
  scrollTop: number;
}

export const DEFAULT_PREVIEW_NAVIGATION_STATE: Readonly<ScopedPreviewNavigationState> =
  Object.freeze({ collapsed: false, scrollTop: 0 });

const ROLES = new Set(["owner", "admin", "member", "guest"]);

/** Reject the entire malformed snapshot, not just suspicious individual rows.
 * This is UI validation only: authorization remains in the Convex query. */
export function verifiedNavigationSummaries(value: unknown): WorkspaceNavigationSummary[] | null {
  if (!Array.isArray(value) || value.length > 50) return null;
  const seen = new Set<string>();
  const result: WorkspaceNavigationSummary[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    const fields = row as Record<string, unknown>;
    if (Object.keys(fields).sort().join(",") !== "role,workspaceId" ||
        typeof fields.workspaceId !== "string" || !validWorkspaceId(fields.workspaceId) ||
        typeof fields.role !== "string" || !ROLES.has(fields.role) ||
        seen.has(fields.workspaceId)) return null;
    seen.add(fields.workspaceId);
    result.push({ workspaceId: fields.workspaceId, role: fields.role as WorkspaceNavigationSummary["role"] });
  }
  return result;
}

/** Never interpret arbitrary paths as workspace IDs or navigation permissions. */
export function isWorkspacePreviewRoute(pathname: string): boolean {
  if (!pathname.startsWith("/w/")) return false;
  const id = pathname.slice(3);
  return workspacePreviewHref(id) === pathname;
}

/** The personal editor must not be torn down by a workspace switch.
 * Only metadata previews may switch in the same tab. */
export function workspaceSwitchIntent(
  pathname: string,
  workspaceId: string,
  currentMemberships: readonly WorkspaceNavigationSummary[],
): { href: string; newTab: boolean } | null {
  const href = workspacePreviewHref(workspaceId);
  if (!href || !currentMemberships.some((row) => row.workspaceId === workspaceId)) return null;
  return { href, newTab: !isWorkspacePreviewRoute(pathname) };
}

/** Per authenticated account AND per validated workspace. Never a global key. */
export function previewNavigationStorageKey(accountId: string | null | undefined, workspaceId: string): string | null {
  if (!accountId || !validPrincipalId(accountId) || !validWorkspaceId(workspaceId)) return null;
  return "max:v2:preview-navigation:" + encodeURIComponent(accountId) + ":" + workspaceId;
}

export function normalizePreviewNavigationState(value: unknown): ScopedPreviewNavigationState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).sort().join(",") !== "collapsed,scrollTop" ||
      typeof input.collapsed !== "boolean" ||
      typeof input.scrollTop !== "number" || !Number.isSafeInteger(input.scrollTop) ||
      input.scrollTop < 0 || input.scrollTop > 100000) return null;
  return { collapsed: input.collapsed, scrollTop: input.scrollTop };
}

export function readPreviewNavigationState(
  storage: { getItem(key: string): string | null },
  accountId: string | null | undefined,
  workspaceId: string,
): ScopedPreviewNavigationState {
  const key = previewNavigationStorageKey(accountId, workspaceId);
  if (!key) return { ...DEFAULT_PREVIEW_NAVIGATION_STATE };
  try {
    const json = storage.getItem(key);
    if (json === null || json.length > 256) return { ...DEFAULT_PREVIEW_NAVIGATION_STATE };
    return normalizePreviewNavigationState(JSON.parse(json)) ?? { ...DEFAULT_PREVIEW_NAVIGATION_STATE };
  } catch {
    return { ...DEFAULT_PREVIEW_NAVIGATION_STATE };
  }
}

export function writePreviewNavigationState(
  storage: { setItem(key: string, value: string): void },
  accountId: string | null | undefined,
  workspaceId: string,
  state: ScopedPreviewNavigationState,
): boolean {
  const key = previewNavigationStorageKey(accountId, workspaceId);
  const safe = normalizePreviewNavigationState(state);
  if (!key || !safe) return false;
  try {
    storage.setItem(key, JSON.stringify(safe));
    return true;
  } catch {
    return false;
  }
}
