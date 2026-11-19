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

