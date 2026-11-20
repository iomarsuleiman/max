import type { PageSummary } from "./types";

/** The pages outside every teamspace. */
export function withoutTeamspaces(tree: PageSummary[]) {
  const inside = teamspaceMembers(tree);
  return inside.size ? tree.filter((p) => !inside.has(p._id)) : tree;
}

/** Every page in a teamspace, the teamspace itself included. */
export function teamspaceMembers(tree: PageSummary[]) {
  const inside = new Set(tree.filter((p) => p.teamspace && !p.parentId).map((p) => p._id));
  if (!inside.size) return inside;
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of tree) {
      const up = p.parentId ?? p.databaseId;
      if (up && inside.has(up) && !inside.has(p._id)) {
        inside.add(p._id);
        grew = true;
      }
    }
  }
  return inside;
}


/**
 * Drops pages whose parent isn't in the sidebar: pages kept inside a database row (a row's script,
 * notes, nested databases). They belong to their row, not to the top of Private. The server leaves
 * them out too; this keeps the sidebar right with an older server.
 */
export function withoutOrphans(tree: PageSummary[]) {
  const ids = new Set(tree.map((p) => p._id));
  const byId = new Map(tree.map((p) => [p._id, p]));
  const keep = new Map<string, boolean>();
  const rooted = (page: PageSummary): boolean => {
    const known = keep.get(page._id);
    if (known !== undefined) return known;
    keep.set(page._id, false); // guards against a parent loop
    const ok = !page.parentId || (ids.has(page.parentId) && rooted(byId.get(page.parentId)!));
    keep.set(page._id, ok);
    return ok;
  };
  const out = tree.filter(rooted);
  return out.length === tree.length ? tree : out;
}
